//! Unity YAML semantic diff (`.prefab`, `.unity`, `.asset`, ...).
//!
//! Unity text-serializes assets as a stream of YAML documents, one per object:
//!
//! ```text
//! --- !u!<classID> &<fileID> [stripped]
//! TypeName:
//!   m_Prop: value
//! ```
//!
//! Objects reference each other by `{fileID: N}`, so a line diff is close to
//! unreadable. Instead we match objects by fileID across both versions and label
//! every change with its hierarchy path (`Root/Child › Component`).
//!
//! Unity's emitter only uses a small, regular subset of YAML (2-space block
//! indentation, one-line flow maps, `- ` items at the parent key's indent), so
//! lines are flattened into `path -> raw value` pairs rather than pulling in a
//! YAML crate.
//!
//! Properties are labelled the way the Inspector shows them: nicified names,
//! and for materials the shader's display names and types (`unity_schema`).

use crate::git::unity_schema::{self, ScriptSchema, ShaderProp, ValueType};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

const CLASS_GAME_OBJECT: u32 = 1;
const CLASS_TRANSFORM: u32 = 4;
const CLASS_RECT_TRANSFORM: u32 = 224;
const CLASS_PREFAB_INSTANCE: u32 = 1001;

/// Lists whose order is noise; keyed by referenced fileID instead of index.
const SET_LISTS: [&str; 2] = ["m_Children", "m_Component"];
const MODS_PREFIX: &str = "m_Modification.m_Modifications[";

/// True if `text` is a Unity text-serialized asset.
pub fn is_unity_yaml(text: &str) -> bool {
    let head = text.get(..256).unwrap_or(text);
    head.starts_with("%YAML") && head.contains("%TAG !u! tag:unity3d.com")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Added,
    Removed,
    Modified,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PropChange {
    /// Raw serialized path, e.g. `m_SavedProperties.m_Floats._Glossiness`.
    pub key: String,
    /// Inspector-style name: the shader's display name or the nicified key.
    pub label: String,
    /// Inspector-like group within the object; empty for none.
    pub section: String,
    /// Known type (from the shader); the UI infers vectors/colors otherwise.
    pub value_type: Option<ValueType>,
    pub range: Option<[f64; 2]>,
    /// False for unchanged context, shown when the user expands an object.
    pub changed: bool,
    pub old: Option<String>,
    pub new: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObjectChange {
    /// Hierarchy path of the owning GameObject / prefab instance.
    pub path: String,
    /// `GameObject`, `Transform`, script name, `Prefab <name>`, ...
    pub type_name: String,
    /// Unity class from the document header (`Transform`, `MonoBehaviour`,
    /// `PrefabInstance`, ...), for picking an icon.
    pub class_name: String,
    pub kind: ChangeKind,
    /// Changed properties plus, for modified objects, the unchanged rest.
    pub props: Vec<PropChange>,
}

/// Semantic diff of two Unity YAML texts. `assets` resolves guids to names and
/// shaders; an empty index shows raw guids and internal names.
pub fn diff(old: &str, new: &str, assets: &AssetIndex) -> Vec<ObjectChange> {
    let old = Doc::parse(old, assets);
    let new = Doc::parse(new, assets);
    let mut changes = Vec::new();
    for (id, o) in &old.objects {
        let change = match new.objects.get(id) {
            Some(n) => modified(&old, &new, id, o, n),
            None => old.whole(id, o, &new, ChangeKind::Removed),
        };
        changes.extend(change.map(|c| (id, c)));
    }
    for (id, n) in &new.objects {
        if !old.objects.contains_key(id) {
            changes.extend(new.whole(id, n, &old, ChangeKind::Added).map(|c| (id, c)));
        }
    }
    // fileID breaks ties so the order (and the UI's fold state) is stable.
    changes
        .sort_by(|(ia, a), (ib, b)| (&a.path, &a.type_name, ia).cmp(&(&b.path, &b.type_name, ib)));
    changes.into_iter().map(|(_, c)| c).collect()
}

/// guid -> asset path (relative to the project root), from `.meta` files.
#[derive(Debug, Default)]
pub struct AssetIndex {
    root: PathBuf,
    paths: HashMap<String, PathBuf>,
}

impl AssetIndex {
    /// [`AssetIndex::build`] for `root`, once per root per session.
    // ponytail: never invalidated — assets created after the first diff show as
    // guids until restart. Rebuild on a miss if that bites.
    pub fn cached(root: &Path) -> Arc<Self> {
        static CACHE: OnceLock<Mutex<HashMap<PathBuf, Arc<AssetIndex>>>> = OnceLock::new();
        let cache = CACHE.get_or_init(Default::default);
        if let Some(hit) = cache.lock().unwrap_or_else(|e| e.into_inner()).get(root) {
            return hit.clone();
        }
        // Built outside the lock: a cold walk of a big project takes a moment.
        let index = Arc::new(Self::build(root));
        cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(root.to_path_buf(), index.clone());
        index
    }

    /// Index every `.meta` under `root`. Of `Library/` only the package cache
    /// is read, and there only scripts and shaders — the bulk is everything else.
    pub fn build(root: &Path) -> Self {
        let mut paths = HashMap::new();
        let mut dirs = vec![(root.to_path_buf(), false)];
        while let Some((dir, in_packages)) = dirs.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let path = entry.path();
                if entry.file_type().is_ok_and(|t| t.is_dir()) {
                    match name.as_str() {
                        "Library" => dirs.push((path.join("PackageCache"), true)),
                        "Temp" | "Logs" | "obj" | ".git" | "node_modules" => {}
                        _ => dirs.push((path, in_packages)),
                    }
                    continue;
                }
                let Some(asset) = name.strip_suffix(".meta") else {
                    continue;
                };
                let wanted = [".cs", ".shader", ".shadergraph"];
                if in_packages && !wanted.iter().any(|e| asset.ends_with(e)) {
                    continue;
                }
                let Ok(text) = std::fs::read_to_string(&path) else {
                    continue;
                };
                if let Some(guid) = text.lines().find_map(|l| l.strip_prefix("guid: ")) {
                    let asset_path = path.with_file_name(asset);
                    let rel = asset_path.strip_prefix(root).unwrap_or(&asset_path);
                    paths.insert(guid.trim().to_string(), rel.to_path_buf());
                }
            }
        }
        Self {
            root: root.to_path_buf(),
            paths,
        }
    }

    fn name(&self, guid: &str) -> Option<&str> {
        self.paths.get(guid)?.file_stem()?.to_str()
    }

    /// Properties of the shader with `guid`, read from disk.
    // ponytail: reads the working-tree shader even when diffing old commits.
    fn shader(&self, guid: &str) -> Option<Vec<ShaderProp>> {
        let rel = self.paths.get(guid)?;
        let text = std::fs::read_to_string(self.root.join(rel)).ok()?;
        unity_schema::parse_shader_file(&rel.to_string_lossy(), &text)
    }

    /// Field metadata of the C# script with `guid`, read from disk.
    // ponytail: re-read per changed object; cache per diff if prefabs with
    // many changed scripts get slow.
    fn script(&self, guid: &str) -> Option<ScriptSchema> {
        let rel = self.paths.get(guid)?;
        if rel.extension()? != "cs" {
            return None;
        }
        let text = std::fs::read_to_string(self.root.join(rel)).ok()?;
        Some(unity_schema::parse_script(
            rel.file_stem()?.to_str()?,
            &text,
        ))
    }
}

#[derive(Debug, Default)]
struct UnityObject {
    class_id: u32,
    type_name: String,
    stripped: bool,
    /// Flattened properties in file order — Unity's serialization order is the
    /// Inspector's field order.
    props: Vec<(String, String)>,
}

impl UnityObject {
    fn get(&self, key: &str) -> Option<&str> {
        self.props
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    fn ref_id(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(file_id)
    }
}

/// `{fileID: 123, guid: ..., type: 3}` -> `123`; `None` for the null ref `0`.
fn file_id(value: &str) -> Option<&str> {
    let id = value
        .strip_prefix("{fileID: ")?
        .split([',', '}'])
        .next()?
        .trim();
    (id != "0").then_some(id)
}

fn guid(value: &str) -> Option<&str> {
    value
        .split("guid: ")
        .nth(1)?
        .split([',', '}'])
        .next()
        .map(str::trim)
}

struct Doc<'a> {
    objects: HashMap<String, UnityObject>,
    /// GameObject fileID -> its (Rect)Transform fileID.
    transforms: HashMap<String, String>,
    assets: &'a AssetIndex,
}

impl<'a> Doc<'a> {
    fn parse(text: &str, assets: &'a AssetIndex) -> Self {
        let mut objects = HashMap::new();
        let mut current: Option<(String, UnityObject, Vec<&str>)> = None;
        for line in text.lines() {
            if let Some(header) = line.strip_prefix("--- !u!") {
                if let Some((id, obj, body)) = current.take() {
                    objects.insert(id, finish(obj, &body));
                }
                let mut parts = header.split_whitespace();
                let class_id = parts.next().and_then(|c| c.parse().ok()).unwrap_or(0);
                let id = parts.next().unwrap_or_default().trim_start_matches('&');
                let obj = UnityObject {
                    class_id,
                    stripped: parts.next() == Some("stripped"),
                    ..Default::default()
                };
                current = Some((id.to_string(), obj, Vec::new()));
            } else if let Some((_, _, body)) = current.as_mut() {
                body.push(line);
            }
        }
        if let Some((id, obj, body)) = current {
            objects.insert(id, finish(obj, &body));
        }

        let transforms = objects
            .iter()
            .filter(|(_, o)| {
                !o.stripped && matches!(o.class_id, CLASS_TRANSFORM | CLASS_RECT_TRANSFORM)
            })
            .filter_map(|(id, o)| Some((o.ref_id("m_GameObject")?.to_string(), id.clone())))
            .collect();
        Self {
            objects,
            transforms,
            assets,
        }
    }

    fn obj(&self, id: &str) -> Option<&UnityObject> {
        self.objects.get(id)
    }

    fn asset_name(&self, reference: Option<&str>) -> Option<String> {
        let g = guid(reference?)?;
        if g.starts_with("0000000000000000") {
            return Some("Built-in".into());
        }
        Some(
            self.assets
                .name(g)
                .map_or_else(|| format!("guid:{}", &g[..g.len().min(8)]), str::to_string),
        )
    }

    fn instance_name(&self, pi: &UnityObject) -> String {
        pi.props
            .iter()
            .find(|(k, _)| *k == "m_Name" || k.starts_with("m_Name @"))
            .map(|(_, v)| v.clone())
            .or_else(|| self.asset_name(pi.get("m_SourcePrefab")))
            .unwrap_or_else(|| "Prefab".into())
    }

    /// Name and parent Transform of a (Rect)Transform. A stripped transform
    /// stands in for a nested prefab instance.
    // ponytail: a stripped transform that isn't the instance root still shows
    // the instance name; resolving it needs the source prefab.
    fn node<'s>(&'s self, t: &'s UnityObject) -> (String, Option<&'s str>) {
        if t.stripped {
            return match t.ref_id("m_PrefabInstance").and_then(|id| self.obj(id)) {
                Some(pi) => (
                    self.instance_name(pi),
                    pi.ref_id("m_Modification.m_TransformParent"),
                ),
                None => ("?".into(), None),
            };
        }
        let name = t
            .ref_id("m_GameObject")
            .and_then(|g| self.obj(g))
            .and_then(|g| g.get("m_Name"))
            .unwrap_or("?");
        (name.to_string(), t.ref_id("m_Father"))
    }

    fn transform_path(&self, id: &str) -> String {
        let mut parts = Vec::new();
        let mut cur = Some(id);
        // Depth cap guards against a corrupt file with a parent cycle.
        while let (Some(t), true) = (cur.and_then(|id| self.obj(id)), parts.len() < 256) {
            let (name, parent) = self.node(t);
            parts.push(name);
            cur = parent;
        }
        parts.reverse();
        parts.join("/")
    }

    fn go_path(&self, go_id: &str) -> String {
        if let Some(t) = self.transforms.get(go_id) {
            return self.transform_path(t);
        }
        let Some(go) = self.obj(go_id) else {
            return "?".into();
        };
        // A stripped stand-in for an object inside a nested prefab.
        // ponytail: lists it under the instance, not the child inside it —
        // naming the child needs the source prefab.
        let instance = go
            .ref_id("m_PrefabInstance")
            .and_then(|id| Some((id, self.obj(id)?)));
        match instance {
            Some((id, pi)) if go.stripped => self.path(id, pi).unwrap_or_else(|| "?".into()),
            _ => self.go_name(go),
        }
    }

    /// A GameObject's name; a stripped stand-in takes its prefab instance's.
    fn go_name(&self, go: &UnityObject) -> String {
        if go.stripped {
            if let Some(pi) = go.ref_id("m_PrefabInstance").and_then(|id| self.obj(id)) {
                return self.instance_name(pi);
            }
        }
        go.get("m_Name").unwrap_or("?").to_string()
    }

    fn type_label(&self, o: &UnityObject) -> String {
        if o.class_id == CLASS_PREFAB_INSTANCE {
            return self
                .asset_name(o.get("m_SourcePrefab"))
                .map_or("Prefab".into(), |n| format!("Prefab {n}"));
        }
        if o.type_name == "MonoBehaviour" {
            if let Some(script) = self.asset_name(o.get("m_Script")) {
                return script;
            }
        }
        o.type_name.clone()
    }

    /// Path a change is listed under; `None` for stripped stand-ins, whose
    /// changes show up on the owning PrefabInstance.
    fn path(&self, id: &str, o: &UnityObject) -> Option<String> {
        if o.stripped {
            return None;
        }
        Some(match o.class_id {
            CLASS_GAME_OBJECT => self.go_path(id),
            CLASS_PREFAB_INSTANCE => {
                let name = self.instance_name(o);
                match o.ref_id("m_Modification.m_TransformParent") {
                    Some(p) => format!("{}/{name}", self.transform_path(p)),
                    None => name,
                }
            }
            _ => match o.ref_id("m_GameObject") {
                Some(g) => self.go_path(g),
                None => o
                    .get("m_Name")
                    .filter(|n| !n.is_empty())
                    .unwrap_or(&o.type_name)
                    .to_string(),
            },
        })
    }

    /// Label for a `{fileID: N}` entry of `list`: children by name,
    /// components by type.
    fn ref_label(&self, list: &str, value: &str) -> String {
        match file_id(value).and_then(|id| self.obj(id)) {
            Some(o) if list == "m_Children" => self.node(o).0,
            Some(o) => self.type_label(o),
            None => value.to_string(),
        }
    }

    /// Readable form of a raw value: object references become names.
    fn display(&self, value: &str) -> String {
        if !value.starts_with("{fileID:") {
            return value.to_string();
        }
        match (file_id(value), guid(value)) {
            (None, _) => "None".into(),
            (Some(_), Some(_)) => self.asset_name(Some(value)).unwrap_or_default(),
            (Some(id), None) => match self.obj(id) {
                Some(o) => self.object_label(o),
                None => value.to_string(),
            },
        }
    }

    /// `Player` for GameObjects/Transforms, `Player (Rigidbody)` for components.
    fn object_label(&self, o: &UnityObject) -> String {
        match o.class_id {
            CLASS_GAME_OBJECT => self.go_name(o),
            CLASS_TRANSFORM | CLASS_RECT_TRANSFORM => self.node(o).0,
            _ => match o
                .ref_id("m_GameObject")
                .and_then(|g| self.obj(g))
                .map(|g| self.go_name(g))
            {
                Some(go) => format!("{go} ({})", self.type_label(o)),
                None => self.type_label(o),
            },
        }
    }

    /// Where `o`'s Inspector metadata comes from: its shader or its script.
    fn schema(&self, o: &UnityObject) -> Schema {
        let asset = |key| o.get(key).and_then(guid);
        match o.type_name.as_str() {
            "Material" => Schema::Material(asset("m_Shader").and_then(|g| self.assets.shader(g))),
            "MonoBehaviour" => {
                Schema::Script(asset("m_Script").and_then(|g| self.assets.script(g)))
            }
            _ => Schema::Plain,
        }
    }

    /// Change for an object that only exists in `self`. Components of an
    /// added/removed GameObject fold into the GameObject's entry.
    fn whole(
        &self,
        id: &str,
        o: &UnityObject,
        other: &Doc,
        kind: ChangeKind,
    ) -> Option<ObjectChange> {
        // Folded into its GameObject's entry, unless that's a stripped
        // stand-in — those aren't listed, so the component must be.
        let owner_listed = o.ref_id("m_GameObject").is_some_and(|g| {
            !other.objects.contains_key(g) && self.obj(g).is_some_and(|go| !go.stripped)
        });
        if owner_listed {
            return None;
        }
        let props = o
            .props
            .iter()
            .filter(|(k, _)| k.starts_with("m_Component["))
            .map(|(_, v)| {
                let name = Some(self.ref_label("m_Component", v));
                let (old, new) = match kind {
                    ChangeKind::Removed => (name, None),
                    _ => (None, name),
                };
                PropChange {
                    key: "m_Component".into(),
                    label: "Component".into(),
                    section: String::new(),
                    value_type: None,
                    range: None,
                    changed: true,
                    old,
                    new,
                }
            })
            .collect();
        Some(ObjectChange {
            path: self.path(id, o)?,
            type_name: self.type_label(o),
            class_name: o.type_name.clone(),
            kind,
            props,
        })
    }
}

fn modified(
    old: &Doc,
    new: &Doc,
    id: &str,
    o: &UnityObject,
    n: &UnityObject,
) -> Option<ObjectChange> {
    if o.props == n.props {
        return None;
    }
    let schema = new.schema(n);
    let values =
        |obj: &'_ UnityObject| -> HashMap<String, String> { obj.props.iter().cloned().collect() };
    let (old_values, new_values) = (values(o), values(n));
    // New file order first; keys only in the old version keep their old position.
    let keys = n.props.iter().enumerate().chain(
        o.props
            .iter()
            .enumerate()
            .filter(|(_, (k, _))| !new_values.contains_key(k)),
    );
    let mut props: Vec<((u8, usize, usize), PropChange)> = keys
        .map(|(order, (k, _))| {
            let (a, b) = (old_values.get(k), new_values.get(k));
            let list = k.split('[').next().filter(|l| SET_LISTS.contains(l));
            let (old_value, new_value) = match list {
                Some(l) => (
                    a.map(|v| old.ref_label(l, v)),
                    b.map(|v| new.ref_label(l, v)),
                ),
                None => {
                    let shown = (a.map(|v| old.display(v)), b.map(|v| new.display(v)));
                    // Two sub-assets of one file (sprites in a sheet) display
                    // alike; show the raw refs so the edit stays visible.
                    if a != b && shown.0 == shown.1 {
                        (a.cloned(), b.cloned())
                    } else {
                        shown
                    }
                }
            };
            let meta = describe(list.unwrap_or(k), n, &schema);
            let prop = PropChange {
                key: k.clone(),
                label: meta.label,
                section: meta.section,
                value_type: meta.value_type,
                range: meta.range,
                changed: a != b && !is_default_tex_transform(k, a, b),
                old: old_value,
                new: new_value,
            };
            ((meta.rank.0, meta.rank.1, order), prop)
        })
        .collect();
    if !props.iter().any(|(_, p)| p.changed) {
        return None;
    }
    props.sort_by_key(|(rank, _)| *rank);
    Some(ObjectChange {
        path: new.path(id, n)?,
        type_name: new.type_label(n),
        class_name: n.type_name.clone(),
        kind: ChangeKind::Modified,
        props: props.into_iter().map(|(_, p)| p).collect(),
    })
}

/// Where an object's Inspector metadata comes from.
enum Schema {
    Material(Option<Vec<ShaderProp>>),
    Script(Option<ScriptSchema>),
    Plain,
}

/// Engine bookkeeping the Inspector doesn't draw as fields.
const INTERNAL: [&str; 8] = [
    "m_ObjectHideFlags",
    "m_CorrespondingSourceObject",
    "m_PrefabInstance",
    "m_PrefabAsset",
    "m_GameObject",
    "m_EditorHideFlags",
    "m_EditorClassIdentifier",
    "serializedVersion",
];

struct PropMeta {
    label: String,
    section: String,
    value_type: Option<ValueType>,
    range: Option<[f64; 2]>,
    /// Sort key: (section group, position within it); ties keep file order.
    rank: (u8, usize),
}

/// Inspector-style label, section and type for a property key of `o`.
/// Materials follow their shader's names and order, scripts their `[Header]`
/// groups; engine bookkeeping sinks into a trailing "Internal" section.
fn describe(key: &str, o: &UnityObject, schema: &Schema) -> PropMeta {
    let generic = |section: &str, rank| PropMeta {
        label: nicify_path(key),
        section: section.into(),
        value_type: None,
        range: None,
        rank,
    };
    let top = key.split(['.', '[']).next().unwrap_or(key);
    let internal = INTERNAL.contains(&top)
        // A component's or asset's name isn't an Inspector field.
        || (top == "m_Name" && !matches!(o.class_id, CLASS_GAME_OBJECT | CLASS_PREFAB_INSTANCE))
        // ScriptableObjects serialize m_Enabled but don't show it.
        || (top == "m_Enabled" && o.type_name == "MonoBehaviour" && o.ref_id("m_GameObject").is_none());
    if internal {
        return generic("Internal", (3, 0));
    }
    match schema {
        Schema::Material(shader) => material_meta(key, shader.as_deref()),
        Schema::Script(script) => {
            let Some((field, section)) = script.as_ref().and_then(|s| s.lookup(key)) else {
                return generic("", (0, 0));
            };
            let value_type = match field.type_name.as_str() {
                _ if field.range.is_some() => Some(ValueType::Range),
                "bool" => Some(ValueType::Toggle),
                "Color" | "Color32" => Some(ValueType::Color),
                _ => None,
            };
            PropMeta {
                label: nicify_path(key),
                section: section.into(),
                value_type,
                range: field.range,
                rank: (0, 0),
            }
        }
        Schema::Plain => generic("", (0, 0)),
    }
}

/// Material properties: shader display names, types and order.
fn material_meta(key: &str, shader: Option<&[ShaderProp]>) -> PropMeta {
    let Some((bucket, rest)) = key
        .strip_prefix("m_SavedProperties.")
        .and_then(|r| r.split_once('.'))
    else {
        return PropMeta {
            label: nicify_path(key),
            section: "Settings".into(),
            value_type: None,
            range: None,
            rank: (1, 0),
        };
    };
    let (reference, field) = match rest.split_once('.') {
        Some((r, f)) => (r, Some(f)),
        None => (rest, None),
    };
    let found = shader.and_then(|s| s.iter().enumerate().find(|(_, p)| p.reference == reference));
    let (section, rank) = match (found, shader) {
        (Some((i, p)), _) if !p.hidden => ("Properties", (0, i)),
        (Some((i, _)), _) => ("Other properties", (2, i)),
        (None, Some(_)) => ("Other properties", (2, usize::MAX)),
        (None, None) => ("Properties", (0, 0)),
    };
    let name = found.map_or_else(|| nicify(reference), |(_, p)| p.display.clone());
    let fallback = match bucket {
        "m_Colors" => Some(ValueType::Color),
        "m_TexEnvs" => Some(ValueType::Texture),
        _ => None,
    };
    let (label, value_type) = match field {
        Some("m_Scale") => (format!("{name} Tiling"), None),
        Some("m_Offset") => (format!("{name} Offset"), None),
        _ => (name, found.map(|(_, p)| p.value_type).or(fallback)),
    };
    PropMeta {
        label,
        section: section.into(),
        value_type,
        range: found.and_then(|(_, p)| p.range),
        rank,
    }
}

/// Default tiling/offset that appears or disappears together with its texture
/// slot is serialization noise, not an edit.
fn is_default_tex_transform(key: &str, a: Option<&String>, b: Option<&String>) -> bool {
    let ((None, Some(v)) | (Some(v), None)) = (a, b) else {
        return false;
    };
    key.starts_with("m_SavedProperties.m_TexEnvs.")
        && ((key.ends_with(".m_Scale") && v == "{x: 1, y: 1}")
            || (key.ends_with(".m_Offset") && v == "{x: 0, y: 0}"))
}

/// `m_Lens.FieldOfView` -> "Lens › Field Of View"; prefab override targets
/// (`m_Name @123`) are dropped.
fn nicify_path(key: &str) -> String {
    let key = key.split(" @").next().unwrap_or(key);
    key.replace(".Array.data[", "[")
        .split('.')
        .map(nicify)
        .collect::<Vec<_>>()
        .join(" › ")
}

/// Unity's `ObjectNames.NicifyVariableName`: `m_LocalPosition` -> "Local
/// Position", `_BaseColor` -> "Base Color", `HDRColor` -> "HDR Color".
fn nicify(name: &str) -> String {
    let (base, index) = name.find('[').map_or((name, ""), |i| name.split_at(i));
    let base = base
        .strip_prefix("m_")
        .unwrap_or(base)
        .trim_start_matches('_');
    let chars: Vec<char> = base.chars().collect();
    let mut out = String::new();
    for (i, &c) in chars.iter().enumerate() {
        if c == '_' {
            if !out.is_empty() && !out.ends_with(' ') {
                out.push(' ');
            }
            continue;
        }
        let prev = i.checked_sub(1).and_then(|j| chars.get(j));
        let next = chars.get(i + 1);
        let word_start = c.is_uppercase()
            && prev.is_some_and(|p| {
                p.is_lowercase() || (p.is_uppercase() && next.is_some_and(|n| n.is_lowercase()))
            });
        if word_start && !out.ends_with(' ') {
            out.push(' ');
        }
        if out.is_empty() {
            out.extend(c.to_uppercase());
        } else {
            out.push(c);
        }
    }
    out + index
}

/// Build an object from its document body (`TypeName:` line + properties).
fn finish(mut obj: UnityObject, body: &[&str]) -> UnityObject {
    if let Some((first, rest)) = body.split_first() {
        obj.type_name = first.trim_end_matches(':').to_string();
        obj.props = rekey(flatten(rest));
    }
    obj
}

/// Flatten a block of Unity YAML into `a.b[0].c -> raw value` pairs.
fn flatten(lines: &[&str]) -> Vec<(String, String)> {
    struct Frame {
        indent: usize,
        path: String,
        items: usize,
    }
    let mut out: Vec<(String, String)> = Vec::new();
    let mut stack = vec![Frame {
        indent: 0,
        path: String::new(),
        items: 0,
    }];
    // Index of the last scalar, for values Unity wrapped onto the next line.
    let mut last: Option<usize> = None;

    for line in lines {
        let mut content = line.trim_start_matches(' ');
        if content.is_empty() {
            continue;
        }
        let mut indent = line.len() - content.len();

        // Quoted scalar Unity wrapped onto the next line(s).
        if let Some((_, value)) = last.and_then(|i| out.get_mut(i)) {
            if open_quote(value) {
                value.push(' ');
                value.push_str(content);
                continue;
            }
        }

        // Sequence item: `- ` sits at the owning key's indent.
        if let Some(item) = content
            .strip_prefix("- ")
            .or((content == "-").then_some(""))
        {
            stack.retain(|f| f.indent <= indent);
            let Some(owner) = stack.last_mut() else {
                continue;
            };
            let path = format!("{}[{}]", owner.path, owner.items);
            owner.items += 1;
            stack.push(Frame {
                indent: indent + 1,
                path: path.clone(),
                items: 0,
            });
            if item.is_empty() {
                continue;
            }
            if !is_key(item) {
                out.push((path, item.to_string()));
                last = Some(out.len() - 1);
                continue;
            }
            content = item;
            indent += 2;
        }

        stack.retain(|f| f.indent < indent);
        let base = stack.last().map(|f| f.path.clone()).unwrap_or_default();
        if let Some((key, value)) = content.split_once(": ") {
            last = if value != "[]" && value != "{}" {
                out.push((join(&base, key), value.to_string()));
                Some(out.len() - 1)
            } else {
                None
            };
        } else if let Some(key) = content.strip_suffix(':') {
            stack.push(Frame {
                indent,
                path: join(&base, key),
                items: 0,
            });
        } else if let Some((_, value)) = last.and_then(|i| out.get_mut(i)) {
            // Plain scalar wrapped onto the next line.
            value.push(' ');
            value.push_str(content);
        }
    }
    out
}

/// Re-key order-insensitive lists so reordering or inserting one entry
/// doesn't shift every index after it:
/// - `m_Children[i]` / `m_Component[i].component` -> `m_Children[<fileID>]`
/// - PrefabInstance modifications -> `<propertyPath> @<target>` (labels drop
///   the target)
/// - lists of named entries -> by name (see [`key_named_lists`])
fn rekey(props: Vec<(String, String)>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut mods: BTreeMap<usize, HashMap<String, String>> = BTreeMap::new();
    let mut mods_at = None;
    for (key, value) in props {
        if let Some((idx, field)) = key
            .strip_prefix(MODS_PREFIX)
            .and_then(|r| r.split_once("]."))
        {
            if let Ok(i) = idx.parse() {
                mods_at.get_or_insert(out.len());
                mods.entry(i).or_default().insert(field.to_string(), value);
                continue;
            }
        }
        let list = key.split('[').next().unwrap_or_default();
        if SET_LISTS.contains(&list) {
            if let Some(id) = file_id(&value).map(str::to_string) {
                out.push((format!("{list}[{id}]"), value));
                continue;
            }
        }
        out.push((key, value));
    }

    let mut overrides = Vec::new();
    for m in mods.values() {
        let (Some(path), Some(target)) = (
            m.get("propertyPath"),
            m.get("target").and_then(|t| file_id(t)),
        ) else {
            continue;
        };
        let key = format!("{path} @{target}");
        let value = m
            .get("objectReference")
            .filter(|r| file_id(r).is_some())
            .or(m.get("value"))
            .cloned()
            .unwrap_or_default();
        overrides.push((key, value));
    }
    let at = mods_at.unwrap_or(out.len());
    out.splice(at..at, overrides);
    key_named_lists(out)
}

/// Lists whose items are single-key maps with unique names (how Materials
/// store properties: `- _Glossiness: 0.5`) are keyed by that name, so
/// `m_Floats[3]._Glossiness` becomes `m_Floats._Glossiness`.
// ponytail: only the first `[i]` of a key; nested named lists stay indexed.
fn key_named_lists(props: Vec<(String, String)>) -> Vec<(String, String)> {
    // list path -> item index -> distinct child keys
    let mut lists: HashMap<&str, HashMap<&str, BTreeSet<&str>>> = HashMap::new();
    for (key, _) in &props {
        if let Some((list, idx, child, _)) = split_item(key) {
            lists
                .entry(list)
                .or_default()
                .entry(idx)
                .or_default()
                .insert(child);
        }
    }
    let named: BTreeSet<String> = lists
        .into_iter()
        .filter(|(list, items)| {
            let mut names = BTreeSet::new();
            let unique = items.values().all(|children| {
                children.len() == 1 && children.iter().all(|c| !c.is_empty() && names.insert(*c))
            });
            // One item can't tell a name from a field (`- id: 1`); material
            // buckets are named even with one entry.
            unique && (items.len() > 1 || list.starts_with("m_SavedProperties."))
        })
        .map(|(list, _)| list.to_string())
        .collect();
    if named.is_empty() {
        return props;
    }
    props
        .into_iter()
        .map(|(key, value)| match split_item(&key) {
            Some((list, _, child, tail)) if named.contains(list) => {
                (format!("{list}.{child}{tail}"), value)
            }
            _ => (key, value),
        })
        .collect()
}

/// `a.list[3].name.rest` -> (`a.list`, `3`, `name`, `.rest`). Scalar items
/// (`list[3]`) get an empty name.
fn split_item(key: &str) -> Option<(&str, &str, &str, &str)> {
    let (list, rest) = key.split_once('[')?;
    let (idx, rest) = rest.split_once(']')?;
    let Some(rest) = rest.strip_prefix('.') else {
        return Some((list, idx, "", rest));
    };
    let end = rest.find(['.', '[']).unwrap_or(rest.len());
    Some((list, idx, &rest[..end], &rest[end..]))
}

fn is_key(s: &str) -> bool {
    !s.starts_with(['{', '[', '\'', '"']) && (s.contains(": ") || s.ends_with(':'))
}

fn open_quote(v: &str) -> bool {
    match v.chars().next() {
        Some(q @ ('\'' | '"')) => v.len() < 2 || !v.ends_with(q),
        _ => false,
    }
}

fn join(base: &str, key: &str) -> String {
    if base.is_empty() {
        key.to_string()
    } else {
        format!("{base}.{key}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OLD: &str = "%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &10
GameObject:
  m_Component:
  - component: {fileID: 11}
  m_Name: Root
--- !u!4 &11
Transform:
  m_GameObject: {fileID: 10}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_Children:
  - {fileID: 21}
  - {fileID: 31}
  m_Father: {fileID: 0}
--- !u!1 &20
GameObject:
  m_Component:
  - component: {fileID: 21}
  - component: {fileID: 22}
  m_Name: EnvEffectSpawner
--- !u!4 &21
Transform:
  m_GameObject: {fileID: 20}
  m_Children: []
  m_Father: {fileID: 11}
--- !u!114 &22
MonoBehaviour:
  m_GameObject: {fileID: 20}
  m_Script: {fileID: 11500000, guid: abc123, type: 3}
  m_Name:
  _offset: {x: -25, y: 0, z: 25}
--- !u!1001 &30
PrefabInstance:
  m_Modification:
    m_TransformParent: {fileID: 11}
    m_Modifications:
    - target: {fileID: 900, guid: def456, type: 3}
      propertyPath: m_Name
      value: wall_4
      objectReference: {fileID: 0}
    - target: {fileID: 901, guid: def456, type: 3}
      propertyPath: m_LocalPosition.x
      value: -27.4
      objectReference: {fileID: 0}
    m_RemovedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: def456, type: 3}
--- !u!4 &31 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 901, guid: def456, type: 3}
  m_PrefabInstance: {fileID: 30}
";

    /// OLD with the spawner deleted, Root moved, and the wall override changed.
    fn new_version() -> String {
        let start = OLD.find("--- !u!1 &20").unwrap_or_default();
        let end = OLD.find("--- !u!1001").unwrap_or_default();
        format!("{}{}", &OLD[..start], &OLD[end..])
            .replace("  - {fileID: 21}\n", "")
            .replace("{x: 0, y: 0, z: 0}", "{x: 1, y: 0, z: 0}")
            .replace("value: -27.4", "value: -20")
    }

    impl AssetIndex {
        fn with_paths(root: &Path, paths: &[(&str, &str)]) -> Self {
            Self {
                root: root.to_path_buf(),
                paths: paths
                    .iter()
                    .map(|(g, p)| (g.to_string(), PathBuf::from(p)))
                    .collect(),
            }
        }
    }

    /// `path|type|kind|[(label, old, new)]` of the changed props only.
    fn summary(changes: &[ObjectChange]) -> Vec<String> {
        changes
            .iter()
            .map(|c| {
                let props: Vec<_> = c
                    .props
                    .iter()
                    .filter(|p| p.changed)
                    .map(|p| (p.label.as_str(), p.old.as_deref(), p.new.as_deref()))
                    .collect();
                format!("{}|{}|{:?}|{props:?}", c.path, c.type_name, c.kind)
            })
            .collect()
    }

    fn line(
        path: &str,
        type_name: &str,
        kind: ChangeKind,
        props: &[(&str, Option<&str>, Option<&str>)],
    ) -> String {
        format!("{path}|{type_name}|{kind:?}|{props:?}")
    }

    #[test]
    fn diffs_by_object_with_hierarchy_paths() {
        let assets = AssetIndex::with_paths(
            Path::new(""),
            &[
                ("abc123", "Assets/EnvEffectSpawner.cs"),
                ("def456", "Assets/wall.prefab"),
            ],
        );
        let changes = diff(OLD, &new_version(), &assets);
        assert_eq!(
            summary(&changes),
            vec![
                line(
                    "Root",
                    "Transform",
                    ChangeKind::Modified,
                    &[
                        (
                            "Local Position",
                            Some("{x: 0, y: 0, z: 0}"),
                            Some("{x: 1, y: 0, z: 0}")
                        ),
                        ("Children", Some("EnvEffectSpawner"), None),
                    ],
                ),
                line(
                    "Root/EnvEffectSpawner",
                    "GameObject",
                    ChangeKind::Removed,
                    &[
                        ("Component", Some("Transform"), None),
                        ("Component", Some("EnvEffectSpawner"), None),
                    ],
                ),
                line(
                    "Root/wall_4",
                    "Prefab wall",
                    ChangeKind::Modified,
                    &[("Local Position › X", Some("-27.4"), Some("-20"))],
                ),
            ]
        );
        // Unchanged props ride along as context, with refs shown as names.
        let root = &changes[0].props;
        let father = root.iter().find(|p| p.key == "m_Father");
        assert_eq!(
            father.map(|p| (p.changed, p.new.as_deref())),
            Some((false, Some("None")))
        );
        let child = root.iter().find(|p| !p.changed && p.label == "Children");
        assert_eq!(child.and_then(|p| p.new.as_deref()), Some("wall_4"));
    }

    fn material(shader_guid: &str, floats: &str, tex_envs: &str) -> String {
        format!(
            "%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!21 &2100000
Material:
  m_Name: mat
  m_Shader: {{fileID: 4800000, guid: {shader_guid}, type: 3}}
  m_SavedProperties:
    m_TexEnvs:
{tex_envs}    m_Floats:
{floats}    m_Colors:
    - Vector2_BA7C6E14: {{r: 5, g: 5, b: 0, a: 0}}
"
        )
    }

    #[test]
    fn keys_material_property_lists_by_name() {
        let tex = "    - _MainTex:\n        m_Scale: {x: 1, y: 1}\n";
        let old = material("none", "    - _A: 1\n    - _C: 3\n", tex);
        let new = material("none", "    - _A: 1\n    - _B: 2\n    - _C: 4\n", tex);
        let changes = diff(&old, &new, &AssetIndex::default());
        assert_eq!(
            summary(&changes),
            vec![line(
                "mat",
                "Material",
                ChangeKind::Modified,
                &[("B", None, Some("2")), ("C", Some("3"), Some("4"))],
            )]
        );
        // Nested items are named too.
        let props = rekey(flatten(&[
            "  m_SavedProperties:",
            "    m_TexEnvs:",
            "    - _MainTex:",
            "        m_Scale: 1",
        ]));
        assert!(props
            .iter()
            .any(|(k, _)| k == "m_SavedProperties.m_TexEnvs._MainTex.m_Scale"));
        // A one-element script list stays indexed, so growing it doesn't
        // rename every key.
        let props = rekey(flatten(&["  items:", "  - id: 1"]));
        assert!(props.iter().any(|(k, _)| k == "items[0].id"));
    }

    #[test]
    fn sub_asset_swap_shows_raw_refs() {
        let sprite = |id: &str| {
            format!(
                "%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!212 &5
SpriteRenderer:
  m_Sprite: {{fileID: {id}, guid: sheet1, type: 3}}
"
            )
        };
        let assets = AssetIndex::with_paths(Path::new(""), &[("sheet1", "Assets/sheet.png")]);
        let changes = diff(&sprite("21300000"), &sprite("21300002"), &assets);
        let p = &changes[0].props[0];
        assert!(p.changed);
        assert_ne!(p.old, p.new);
    }

    #[test]
    fn labels_material_props_from_shader() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            dir.path().join("Foliage.shader"),
            r#"Shader "Foliage" {
    Properties {
        _Mask ("Screen Dissolve Mask", 2D) = "white" {}
        Vector2_BA7C6E14 ("WindMoveSpeed", Vector) = (0,0,0,0)
        _Radius ("Screen Dissolve Radius", Range(0, 2)) = 0.35
        [HideInInspector] _SrcBlend ("Src Blend", Float) = 1
    }
}"#,
        )
        .expect("write shader");
        let assets = AssetIndex::with_paths(dir.path(), &[("sg1", "Foliage.shader")]);
        let old = material("sg1", "    - _SrcBlend: 1\n    - _Internal: 0\n", "");
        let new = material(
            "sg1",
            "    - _Radius: 0.35\n    - _SrcBlend: 0\n    - _Internal: 1\n",
            "    - _Mask:\n        m_Texture: {fileID: 0}\n        m_Scale: {x: 1, y: 1}\n        m_Offset: {x: 0, y: 0}\n",
        );
        let changes = diff(&old, &new, &assets);
        let got: Vec<_> = changes[0]
            .props
            .iter()
            .map(|p| {
                (
                    p.section.as_str(),
                    p.label.as_str(),
                    p.value_type,
                    p.changed,
                )
            })
            .collect();
        assert_eq!(
            got,
            vec![
                // Shader order; the slot's default tiling/offset is context.
                (
                    "Properties",
                    "Screen Dissolve Mask",
                    Some(ValueType::Texture),
                    true
                ),
                ("Properties", "Screen Dissolve Mask Tiling", None, false),
                ("Properties", "Screen Dissolve Mask Offset", None, false),
                (
                    "Properties",
                    "WindMoveSpeed",
                    Some(ValueType::Vector4),
                    false
                ),
                (
                    "Properties",
                    "Screen Dissolve Radius",
                    Some(ValueType::Range),
                    true
                ),
                ("Settings", "Shader", None, false),
                (
                    "Other properties",
                    "Src Blend",
                    Some(ValueType::Float),
                    true
                ),
                ("Other properties", "Internal", None, true),
                ("Internal", "Name", None, false),
            ]
        );
        let mask = &changes[0].props[0];
        assert_eq!(mask.new.as_deref(), Some("None"));
    }

    #[test]
    fn groups_script_fields_by_header_in_declaration_order() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            dir.path().join("SceneDataSO.cs"),
            r#"public class SceneDataSO : ScriptableObject
{
    [Header("General")]
    public string title;
    [Header("Lighting")]
    public LevelLightData levelLightData;

    [Serializable]
    public struct LevelLightData
    {
        public bool _isLightEnabled;
    }
}"#,
        )
        .expect("write script");
        let assets = AssetIndex::with_paths(dir.path(), &[("s1", "SceneDataSO.cs")]);
        let asset = |title: &str, light: u8| {
            format!(
                "%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &11400000
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_GameObject: {{fileID: 0}}
  m_Enabled: 1
  m_Script: {{fileID: 11500000, guid: s1, type: 3}}
  m_Name: sceneData
  title: {title}
  levelLightData:
    _isLightEnabled: {light}
"
            )
        };
        let changes = diff(&asset("Old", 0), &asset("New", 1), &assets);
        let got: Vec<_> = changes[0]
            .props
            .iter()
            .map(|p| {
                (
                    p.section.as_str(),
                    p.label.as_str(),
                    p.value_type,
                    p.changed,
                )
            })
            .collect();
        assert_eq!(
            got,
            vec![
                ("", "Script", None, false),
                ("General", "Title", None, true),
                (
                    "Lighting",
                    "Level Light Data › Is Light Enabled",
                    Some(ValueType::Toggle),
                    true
                ),
                ("Internal", "Object Hide Flags", None, false),
                ("Internal", "Game Object", None, false),
                ("Internal", "Enabled", None, false),
                ("Internal", "Name", None, false),
            ]
        );
    }

    #[test]
    fn lists_component_added_to_nested_prefab_object() {
        // OLD's wall_4 instance gains a Rigidbody on a stripped stand-in.
        let new = format!(
            "{OLD}--- !u!1 &40 stripped
GameObject:
  m_CorrespondingSourceObject: {{fileID: 900, guid: def456, type: 3}}
  m_PrefabInstance: {{fileID: 30}}
--- !u!54 &41
Rigidbody:
  m_GameObject: {{fileID: 40}}
  m_Mass: 1
"
        );
        let changes = diff(OLD, &new, &AssetIndex::default());
        let added: Vec<_> = changes
            .iter()
            .filter(|c| c.kind == ChangeKind::Added)
            .map(|c| (c.path.as_str(), c.type_name.as_str()))
            .collect();
        assert_eq!(added, vec![("Root/wall_4", "Rigidbody")]);
    }

    #[test]
    fn nicifies_like_the_inspector() {
        for (raw, want) in [
            ("m_LocalPosition", "Local Position"),
            ("_ScreenDissolveRadius", "Screen Dissolve Radius"),
            ("HDRColor", "HDR Color"),
            ("FieldOfView", "Field Of View"),
            ("m_Materials[0]", "Materials[0]"),
            ("x", "X"),
        ] {
            assert_eq!(nicify(raw), want);
        }
        assert_eq!(nicify_path("m_Materials.Array.data[0]"), "Materials[0]");
    }

    #[test]
    fn flattens_nested_items_and_wrapped_strings() {
        let lines = [
            "  m_List:",
            "  - a: 1",
            "    b:",
            "      c: 2",
            "  - 3",
            "  m_Text: 'long text",
            "    continued'",
            "  m_Empty: ",
        ];
        let got = flatten(&lines);
        let want: Vec<(String, String)> = [
            ("m_List[0].a", "1"),
            ("m_List[0].b.c", "2"),
            ("m_List[1]", "3"),
            ("m_Text", "'long text continued'"),
            ("m_Empty", ""),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        assert_eq!(got, want);
    }

    /// Manual check against real files:
    /// `UNITY_OLD=a.prefab UNITY_NEW=b.prefab [UNITY_PROJECT=dir] cargo test unity_yaml -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn print_real_diff() {
        let (Ok(old), Ok(new)) = (std::env::var("UNITY_OLD"), std::env::var("UNITY_NEW")) else {
            return;
        };
        let assets = std::env::var("UNITY_PROJECT")
            .map(|p| AssetIndex::build(Path::new(&p)))
            .unwrap_or_default();
        let (old, new) = (
            std::fs::read_to_string(old).expect("read UNITY_OLD"),
            std::fs::read_to_string(new).expect("read UNITY_NEW"),
        );
        let start = std::time::Instant::now();
        let changes = diff(&old, &new, &assets);
        println!("{} changes in {:?}\n", changes.len(), start.elapsed());
        if let Ok(out) = std::env::var("UNITY_JSON") {
            let json = serde_json::to_string(&changes).expect("serialize");
            std::fs::write(out, json).expect("write UNITY_JSON");
        }
        for c in changes {
            let sign = match c.kind {
                ChangeKind::Added => '+',
                ChangeKind::Removed => '-',
                ChangeKind::Modified => '~',
            };
            println!("{sign} {} › {}", c.path, c.type_name);
            for p in c.props.into_iter().filter(|p| p.changed) {
                let show = |v: Option<String>| v.unwrap_or_else(|| "∅".into());
                let section = if p.section.is_empty() {
                    String::new()
                } else {
                    format!("[{}] ", p.section)
                };
                println!(
                    "    {section}{}: {} → {}",
                    p.label,
                    show(p.old),
                    show(p.new)
                );
            }
        }
    }
}
