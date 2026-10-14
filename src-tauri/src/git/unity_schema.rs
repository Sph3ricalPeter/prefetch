//! Property metadata for the Unity semantic diff, so values read like the
//! Inspector shows them.
//!
//! Materials, from their shader: `Vector2_BA7C6E14` -> "WindMoveSpeed", a
//! Vector2 stored as `{r, g, b, a}`.
//! - `.shadergraph`: a stream of JSON objects; the `GraphData` object lists
//!   property ids, each property object has `m_Name` (display name) and a
//!   default/override reference name (what the material stores).
//! - `.shader`: the ShaderLab `Properties { _Name ("Display", Type) = default }`
//!   block.
//!
//! MonoBehaviours / ScriptableObjects, from their C# script: `[Header]`
//! groups, `bool` fields as toggles, `[Range]` sliders. Field order needs no
//! script — Unity serializes in declaration order.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ValueType {
    Float,
    Range,
    Toggle,
    Color,
    Vector2,
    Vector3,
    Vector4,
    Texture,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ShaderProp {
    /// Name the material serializes, e.g. `_BaseColor` or `Vector1_59FDA86A`.
    pub reference: String,
    pub display: String,
    pub value_type: ValueType,
    pub range: Option<[f64; 2]>,
    /// Not drawn by the Inspector (`[HideInInspector]`, hidden graph property).
    pub hidden: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScriptField {
    pub name: String,
    pub type_name: String,
    /// Last `[Header]` at or above the field within its type; empty for none.
    pub section: String,
    pub range: Option<[f64; 2]>,
}

/// Fields of the types declared in one C# file.
#[derive(Debug, Default)]
pub struct ScriptSchema {
    /// The serialized class (Unity requires it to match the file name).
    pub main: String,
    pub types: HashMap<String, Vec<ScriptField>>,
}

impl ScriptSchema {
    /// Field at a serialized path (`levelLightData._isLightEnabled`), walking
    /// nested types declared in the same file, plus the top-level field's
    /// header section.
    pub fn lookup(&self, key: &str) -> Option<(&ScriptField, &str)> {
        let mut segments = key.split('.').map(|s| s.split('[').next().unwrap_or(s));
        let top = self.field(&self.main, segments.next()?)?;
        let mut leaf = top;
        for segment in segments {
            leaf = self.field(&leaf.type_name, segment)?;
        }
        Some((leaf, top.section.as_str()))
    }

    fn field(&self, type_name: &str, name: &str) -> Option<&ScriptField> {
        self.types.get(type_name)?.iter().find(|f| f.name == name)
    }
}

/// Field declarations of every class/struct in a C# file.
// ponytail: a line scanner, not a C# parser — one declaration per line;
// inherited fields and types from other files get no metadata.
pub fn parse_script(main: &str, text: &str) -> ScriptSchema {
    let mut types: HashMap<String, Vec<ScriptField>> = HashMap::new();
    // (type name, depth of its body, current header)
    let mut stack: Vec<(String, i32, String)> = Vec::new();
    let mut depth = 0;
    let mut pending_type: Option<String> = None;
    let mut pending_range = None;
    for raw in text.lines() {
        let line = raw.split("//").next().unwrap_or_default().trim();
        if let Some(name) = type_decl(line) {
            pending_type = Some(name);
        } else if let Some(top) = stack.last_mut().filter(|t| t.1 == depth) {
            if let Some(header) = attr_string(line, "Header(") {
                top.2 = header;
            }
            pending_range = range_attr(line).or(pending_range);
            if let Some((type_name, name)) = field_decl(line) {
                types.entry(top.0.clone()).or_default().push(ScriptField {
                    name,
                    type_name,
                    section: top.2.clone(),
                    range: pending_range.take(),
                });
            }
        }
        for c in line.chars() {
            match c {
                '{' => {
                    depth += 1;
                    if let Some(name) = pending_type.take() {
                        stack.push((name, depth, String::new()));
                    }
                }
                '}' => {
                    if stack.last().is_some_and(|t| t.1 == depth) {
                        stack.pop();
                    }
                    depth -= 1;
                }
                _ => {}
            }
        }
    }
    ScriptSchema {
        main: main.to_string(),
        types,
    }
}

/// `public class Foo : Bar` / `struct Foo` -> `Foo`.
fn type_decl(line: &str) -> Option<String> {
    let words: Vec<&str> = line
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|w| !w.is_empty())
        .collect();
    words
        .windows(2)
        .find(|w| w[0] == "class" || w[0] == "struct")
        .map(|w| w[1].to_string())
}

/// `[SerializeField] private float _speed = 2f;` -> (`float`, `_speed`).
fn field_decl(line: &str) -> Option<(String, String)> {
    let mut rest = line;
    while let Some(attr) = rest.strip_prefix('[') {
        rest = attr.split_once(']')?.1.trim_start();
    }
    let decl = rest.strip_suffix(';')?.split('=').next()?.trim();
    if decl.contains(['(', ')', '{']) {
        return None;
    }
    let tokens: Vec<&str> = decl.split_whitespace().collect();
    let skip = [
        "static", "const", "readonly", "using", "return", "event", "delegate",
    ];
    if tokens.iter().any(|t| skip.contains(t)) {
        return None;
    }
    let (name, before) = tokens.split_last()?;
    let type_name = before.last()?;
    if !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return None;
    }
    Some((type_name.to_string(), name.to_string()))
}

/// First string argument of an attribute on this line: `[Header("Audio")]`.
fn attr_string(line: &str, attr: &str) -> Option<String> {
    let args = line.strip_prefix('[')?.split(attr).nth(1)?;
    let (_, rest) = args.split_once('"')?;
    Some(rest.split_once('"')?.0.to_string())
}

/// `[Range(0, 1.5f)]` -> `[0.0, 1.5]`.
fn range_attr(line: &str) -> Option<[f64; 2]> {
    let args = line
        .strip_prefix('[')?
        .split("Range(")
        .nth(1)?
        .split_once(')')?
        .0;
    let (lo, hi) = args.split_once(',')?;
    let num = |s: &str| s.trim().trim_end_matches(['f', 'F']).parse().ok();
    Some([num(lo)?, num(hi)?])
}

/// Properties of a shader file, in declaration (= Inspector) order. `None` for
/// unsupported file types.
pub fn parse_shader_file(file_name: &str, text: &str) -> Option<Vec<ShaderProp>> {
    if file_name.ends_with(".shadergraph") {
        Some(parse_shadergraph(text))
    } else if file_name.ends_with(".shader") {
        Some(parse_shader(text))
    } else {
        None
    }
}

// ponytail: Shader Graph v3+ JSON only; pre-2021 graphs (m_SerializedProperties)
// fall back to nicified reference names.
fn parse_shadergraph(text: &str) -> Vec<ShaderProp> {
    let objects: Vec<Value> = serde_json::Deserializer::from_str(text)
        .into_iter::<Value>()
        .map_while(Result::ok)
        .collect();
    let by_id = |id: &str| objects.iter().find(|o| o["m_ObjectId"] == id);
    let Some(graph) = objects
        .iter()
        .find(|o| o["m_Type"] == "UnityEditor.ShaderGraph.GraphData")
    else {
        return Vec::new();
    };
    let ids = graph["m_Properties"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    ids.iter()
        .filter_map(|r| by_id(r["m_Id"].as_str()?))
        .filter_map(|p| {
            let kind = p["m_Type"].as_str()?.rsplit('.').next()?;
            let (value_type, range) = match kind {
                "Vector1ShaderProperty" if p["m_FloatType"] == 1 => {
                    let r = &p["m_RangeValues"];
                    (ValueType::Range, Some([r["x"].as_f64()?, r["y"].as_f64()?]))
                }
                "Vector1ShaderProperty" => (ValueType::Float, None),
                "BooleanShaderProperty" => (ValueType::Toggle, None),
                "ColorShaderProperty" => (ValueType::Color, None),
                "Vector2ShaderProperty" => (ValueType::Vector2, None),
                "Vector3ShaderProperty" => (ValueType::Vector3, None),
                "Vector4ShaderProperty" => (ValueType::Vector4, None),
                k if k.contains("Texture") || k.contains("Cubemap") => (ValueType::Texture, None),
                _ => return None,
            };
            let reference = [&p["m_OverrideReferenceName"], &p["m_DefaultReferenceName"]]
                .into_iter()
                .filter_map(Value::as_str)
                .find(|s| !s.is_empty())?;
            Some(ShaderProp {
                reference: reference.to_string(),
                display: p["m_Name"].as_str().unwrap_or(reference).to_string(),
                value_type,
                range,
                hidden: p["m_Hidden"] == true,
            })
        })
        .collect()
}

// ponytail: one property per line, the way ShaderLab is written in practice.
fn parse_shader(text: &str) -> Vec<ShaderProp> {
    let Some(start) = text.find("Properties") else {
        return Vec::new();
    };
    let mut depth = 0;
    let mut out = Vec::new();
    for line in text[start..].lines() {
        let line = line.split("//").next().unwrap_or_default().trim();
        if depth == 1 {
            out.extend(parse_shader_line(line));
        }
        depth += line.matches('{').count() as i32 - line.matches('}').count() as i32;
        if depth <= 0 && line.contains('}') {
            break;
        }
    }
    out
}

/// `[Toggle] _Flag ("Use Flag", Float) = 0`
fn parse_shader_line(line: &str) -> Option<ShaderProp> {
    let mut rest = line;
    let (mut toggle, mut hidden) = (false, false);
    while let Some(attr) = rest.strip_prefix('[') {
        let (name, after) = attr.split_once(']')?;
        toggle |= name.contains("Toggle");
        hidden |= name == "HideInInspector";
        rest = after.trim_start();
    }
    let (reference, rest) = rest.split_once('(')?;
    let reference = reference.trim();
    if reference.is_empty() || reference.contains(char::is_whitespace) {
        return None;
    }
    let (_, rest) = rest.split_once('"')?;
    let (display, rest) = rest.split_once('"')?;
    let kind = rest.trim_start_matches([',', ' ', '\t']);
    let (value_type, range) = if let Some(args) = kind.strip_prefix("Range") {
        let args = args.trim_start().strip_prefix('(')?.split_once(')')?.0;
        let (lo, hi) = args.split_once(',')?;
        (
            ValueType::Range,
            Some([lo.trim().parse().ok()?, hi.trim().parse().ok()?]),
        )
    } else {
        let word: String = kind.chars().take_while(|c| c.is_alphanumeric()).collect();
        match word.as_str() {
            "Float" | "Int" | "Integer" if toggle => (ValueType::Toggle, None),
            "Float" | "Int" | "Integer" => (ValueType::Float, None),
            "Color" => (ValueType::Color, None),
            "Vector" => (ValueType::Vector4, None),
            "2D" | "3D" | "Cube" | "2DArray" | "CubeArray" | "Any" => (ValueType::Texture, None),
            _ => return None,
        }
    };
    Some(ShaderProp {
        reference: reference.to_string(),
        display: display.to_string(),
        value_type,
        range,
        hidden,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prop(
        reference: &str,
        display: &str,
        value_type: ValueType,
        range: Option<[f64; 2]>,
    ) -> ShaderProp {
        ShaderProp {
            reference: reference.into(),
            display: display.into(),
            value_type,
            range,
            hidden: false,
        }
    }

    #[test]
    fn parses_shaderlab_properties_block() {
        let src = r#"Shader "Custom/Foliage" {
    Properties {
        _BaseColor ("Base Color", Color) = (1,1,1,1)
        [NoScaleOffset] _MainTex ("Albedo", 2D) = "white" {}
        _Cutoff ("Alpha Cutoff", Range(0.0, 1.0)) = 0.5 // trailing comment
        [Toggle(_FOO)] _Foo ("Use Foo", Float) = 0
        _Wind ("Wind", Vector) = (0,0,0,0)
    }
    SubShader { Pass { } }
}"#;
        assert_eq!(
            parse_shader_file("Foliage.shader", src),
            Some(vec![
                prop("_BaseColor", "Base Color", ValueType::Color, None),
                prop("_MainTex", "Albedo", ValueType::Texture, None),
                prop(
                    "_Cutoff",
                    "Alpha Cutoff",
                    ValueType::Range,
                    Some([0.0, 1.0])
                ),
                prop("_Foo", "Use Foo", ValueType::Toggle, None),
                prop("_Wind", "Wind", ValueType::Vector4, None),
            ])
        );
    }

    #[test]
    fn parses_shadergraph_properties() {
        let src = r#"{
    "m_Type": "UnityEditor.ShaderGraph.GraphData",
    "m_ObjectId": "g",
    "m_Properties": [{ "m_Id": "a" }, { "m_Id": "b" }, { "m_Id": "c" }]
}

{
    "m_Type": "UnityEditor.ShaderGraph.Internal.Vector2ShaderProperty",
    "m_ObjectId": "a",
    "m_Name": "WindMoveSpeed",
    "m_DefaultReferenceName": "Vector2_BA7C6E14",
    "m_OverrideReferenceName": ""
}

{
    "m_Type": "UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty",
    "m_ObjectId": "b",
    "m_Name": "Opacity",
    "m_DefaultReferenceName": "Vector1_X",
    "m_OverrideReferenceName": "_Opacity",
    "m_FloatType": 1,
    "m_RangeValues": { "x": 0.0, "y": 2.0 }
}

{
    "m_Type": "UnityEditor.ShaderGraph.Internal.Texture2DShaderProperty",
    "m_ObjectId": "c",
    "m_Name": "Mask",
    "m_DefaultReferenceName": "_Mask",
    "m_OverrideReferenceName": ""
}
"#;
        assert_eq!(
            parse_shader_file("g.shadergraph", src),
            Some(vec![
                prop(
                    "Vector2_BA7C6E14",
                    "WindMoveSpeed",
                    ValueType::Vector2,
                    None
                ),
                prop("_Opacity", "Opacity", ValueType::Range, Some([0.0, 2.0])),
                prop("_Mask", "Mask", ValueType::Texture, None),
            ])
        );
    }

    #[test]
    fn parses_script_fields_headers_and_nested_types() {
        let src = r#"
public class SceneDataSO : ScriptableObject
{
    [Header("General")]
    public string title;
    private static int s_count = 0;

    [Space]
    [Header("Lighting")]
    public LevelLightData levelLightData;
    [SerializeField, Range(0, 2.5f)] private float _intensity = 1f; // inline comment

    public void Apply() { int local = 1; }

    [Serializable]
    public struct LevelLightData
    {
        public bool _isLightEnabled;
    }
}"#;
        let schema = parse_script("SceneDataSO", src);
        let names: Vec<_> = schema.types["SceneDataSO"]
            .iter()
            .map(|f| (f.name.as_str(), f.section.as_str()))
            .collect();
        assert_eq!(
            names,
            vec![
                ("title", "General"),
                ("levelLightData", "Lighting"),
                ("_intensity", "Lighting"),
            ]
        );
        let (leaf, section) = schema
            .lookup("levelLightData._isLightEnabled")
            .expect("nested field");
        assert_eq!((leaf.type_name.as_str(), section), ("bool", "Lighting"));
        let (intensity, _) = schema.lookup("_intensity").expect("field");
        assert_eq!(intensity.range, Some([0.0, 2.5]));
    }
}
