use crate::db::*;
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

fn decode_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&mdash;", "—")
        .replace("&ndash;", "–")
        .replace("&hellip;", "…")
}

pub fn html_to_text(html: &str) -> String {
    let re_br = Regex::new(r"(?i)<br\s*/?>").unwrap();
    let s = re_br.replace_all(html, "\n");
    let re_block = Regex::new(r"(?i)</(p|div|li|h[1-6]|blockquote|tr)>").unwrap();
    let s = re_block.replace_all(&s, "\n");
    let re_tag = Regex::new(r"<[^>]+>").unwrap();
    let s = re_tag.replace_all(&s, "");
    decode_entities(&s).trim().to_string()
}

fn inline_md(html: &str) -> String {
    let mut s = html.to_string();
    let re_link = Regex::new(r#"(?is)<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>"#).unwrap();
    s = re_link
        .replace_all(&s, |caps: &regex::Captures| {
            format!("[{}]({})", html_to_text(&caps[2]), &caps[1])
        })
        .to_string();
    s = Regex::new(r"(?is)<strong[^>]*>(.*?)</strong>")
        .unwrap()
        .replace_all(&s, "**$1**")
        .to_string();
    s = Regex::new(r"(?is)<b[^>]*>(.*?)</b>")
        .unwrap()
        .replace_all(&s, "**$1**")
        .to_string();
    s = Regex::new(r"(?is)<em[^>]*>(.*?)</em>")
        .unwrap()
        .replace_all(&s, "*$1*")
        .to_string();
    s = Regex::new(r"(?is)<i[^>]*>(.*?)</i>")
        .unwrap()
        .replace_all(&s, "*$1*")
        .to_string();
    s = Regex::new(r"(?is)<s[^>]*>(.*?)</s>")
        .unwrap()
        .replace_all(&s, "~~$1~~")
        .to_string();
    s = Regex::new(r"(?is)<del[^>]*>(.*?)</del>")
        .unwrap()
        .replace_all(&s, "~~$1~~")
        .to_string();
    s = Regex::new(r"(?is)<strike[^>]*>(.*?)</strike>")
        .unwrap()
        .replace_all(&s, "~~$1~~")
        .to_string();
    s = Regex::new(r"(?is)<code>(.*?)</code>")
        .unwrap()
        .replace_all(&s, "`$1`")
        .to_string();
    s = Regex::new(r"(?is)<u>(.*?)</u>")
        .unwrap()
        .replace_all(&s, "$1")
        .to_string();
    let re_tag = Regex::new(r"<[^>]+>").unwrap();
    s = re_tag.replace_all(&s, "").to_string();
    decode_entities(&s).trim().to_string()
}

fn value_to_md(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Bool(b) => (if *b { "Yes" } else { "No" }).into(),
        Value::Number(n) => n.to_string(),
        Value::Array(a) => a
            .iter()
            .map(value_to_md)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        Value::Object(o) => o
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .to_string(),
    }
}

fn prop_name(properties: &Value, id: &str) -> String {
    properties
        .as_array()
        .and_then(|arr| {
            arr.iter()
                .find(|p| p.get("id").and_then(|i| i.as_str()) == Some(id))
        })
        .and_then(|p| p.get("name").and_then(|n| n.as_str()))
        .unwrap_or(id)
        .to_string()
}

pub fn to_markdown(
    page: &Page,
    blocks: &[Block],
    database: &Option<Database>,
    rows: &[DbRow],
) -> String {
    let mut out = String::new();
    if !page.title.is_empty() {
        out.push_str(&format!("# {}\n\n", page.title));
    }
    if let Some(db) = database {
        let props = db.properties.as_array().cloned().unwrap_or_default();
        let ids: Vec<String> = props
            .iter()
            .filter_map(|p| p.get("id").and_then(|i| i.as_str()).map(|s| s.to_string()))
            .collect();
        out.push_str("| ");
        out.push_str(
            &props
                .iter()
                .map(|p| p.get("name").and_then(|n| n.as_str()).unwrap_or(""))
                .collect::<Vec<_>>()
                .join(" | "),
        );
        out.push_str(" |\n|");
        for _ in &props {
            out.push_str(" --- |");
        }
        out.push('\n');
        for row in rows.iter().filter(|r| !r.trashed) {
            out.push_str("| ");
            out.push_str(
                &ids.iter()
                    .map(|id| value_to_md(row.values.get(id).unwrap_or(&Value::Null)).replace('|', "\\|"))
                    .collect::<Vec<_>>()
                    .join(" | "),
            );
            out.push_str(" |\n");
        }
        out.push('\n');
    }
    for b in blocks.iter().filter(|b| b.parent_id.is_none()) {
        let depth = 0;
        render_block(&mut out, b, blocks, depth);
    }
    out.trim_end().to_string() + "\n"
}

fn render_block(out: &mut String, b: &Block, all: &[Block], depth: usize) {
    let indent = "  ".repeat(depth);
    let body = match b.block_type.as_str() {
        "heading1" => format!("## {}\n\n", inline_md(&b.html)),
        "heading2" => format!("### {}\n\n", inline_md(&b.html)),
        "heading3" => format!("#### {}\n\n", inline_md(&b.html)),
        "bulleted_list_item" => format!("{}- {}\n", indent, inline_md(&b.html)),
        "numbered_list_item" => format!("{}1. {}\n", indent, inline_md(&b.html)),
        "to_do" => {
            let checked = b.props.get("checked").and_then(|v| v.as_bool()).unwrap_or(false);
            format!("{}- [{}] {}\n", indent, if checked { "x" } else { " " }, inline_md(&b.html))
        }
        "quote" => format!("> {}\n\n", inline_md(&b.html)),
        "callout" => {
            let icon = b.props.get("icon").and_then(|v| v.as_str()).unwrap_or("💡");
            format!("> {icon} {}\n\n", inline_md(&b.html))
        }
        "toggle" => format!("{}- {}\n", indent, inline_md(&b.html)),
        "divider" => "---\n\n".to_string(),
        "code" => {
            let lang = b.props.get("language").and_then(|v| v.as_str()).unwrap_or("");
            format!("```{}\n{}\n```\n\n", lang, html_to_text(&b.html))
        }
        "table" => {
            let rows = b
                .props
                .get("rows")
                .and_then(|r| r.as_array())
                .cloned()
                .unwrap_or_default();
            let mut table = String::new();
            for (ri, row) in rows.iter().enumerate() {
                let cells = row.as_array().cloned().unwrap_or_default();
                table.push_str("| ");
                table.push_str(
                    &cells
                        .iter()
                        .map(|c| html_to_text(c.as_str().unwrap_or("")).replace('|', "\\|"))
                        .collect::<Vec<_>>()
                        .join(" | "),
                );
                table.push_str(" |\n");
                if ri == 0 {
                    table.push('|');
                    for _ in &cells {
                        table.push_str(" --- |");
                    }
                    table.push('\n');
                }
            }
            format!("{table}\n")
        }
        "page_link" => {
            let text = if b.text.is_empty() { "Untitled" } else { &b.text };
            format!("[{}]({})\n\n", text, b.id)
        }
        "image" => {
            let src = b.props.get("src").and_then(|v| v.as_str()).unwrap_or("");
            let caption = b.props.get("caption").and_then(|v| v.as_str()).unwrap_or("");
            if src.starts_with("data:") {
                format!("![{caption}](image)\n\n")
            } else {
                format!("![{caption}]({src})\n\n")
            }
        }
        "bookmark" => {
            let url = b.props.get("url").and_then(|v| v.as_str()).unwrap_or("");
            format!("[{}]({})\n\n", b.text, url)
        }
        _ => {
            let text = inline_md(&b.html);
            if text.is_empty() {
                String::new()
            } else {
                format!("{}{}\n\n", indent, text)
            }
        }
    };
    out.push_str(&body);
    for child in all.iter().filter(|c| c.parent_id.as_deref() == Some(&b.id)) {
        render_block(out, child, all, depth + 1);
    }
}

pub fn to_html_document(page: &Page, blocks: &[Block]) -> String {
    let mut body = String::new();
    for b in blocks.iter().filter(|b| b.parent_id.is_none()) {
        render_html_block(&mut body, b, blocks);
    }
    let title = if page.title.is_empty() { "Untitled" } else { &page.title };
    format!(
        r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{}</title>
<style>
:root{{--text:#37352f;--muted:rgba(55,53,47,.65);--bg:#fff;--line:rgba(55,53,47,.12)}}
@media (prefers-color-scheme:dark){{:root{{--text:#d4d4d4;--muted:rgba(255,255,255,.5);--bg:#191919;--line:rgba(255,255,255,.12)}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;line-height:1.5}}
main{{max-width:708px;margin:0 auto;padding:80px 32px 120px}}h1{{font-size:40px;margin:0 0 24px;line-height:1.2}}
h2{{font-size:30px;margin:32px 0 8px}}h3{{font-size:24px;margin:24px 0 6px}}h4{{font-size:20px;margin:20px 0 4px}}
p{{margin:3px 0;min-height:1.5em}}blockquote{{border-left:3px solid var(--text);margin:8px 0;padding:2px 14px}}
pre{{background:rgba(135,131,120,.14);padding:16px;border-radius:6px;overflow:auto}}code{{background:rgba(135,131,120,.15);color:#eb5757;padding:2px 5px;border-radius:4px;font-size:.88em}}
pre code{{background:none;color:inherit;padding:0}}ul,ol{{padding-left:26px}}hr{{border:0;border-top:1px solid var(--line);margin:16px 0}}
table{{border-collapse:collapse;width:100%;margin:12px 0}}td,th{{border:1px solid var(--line);padding:7px 9px;text-align:left;font-size:14px}}
img{{max-width:100%;border-radius:4px}}.callout{{background:rgba(135,131,120,.1);padding:14px 16px;border-radius:5px;display:flex;gap:10px}}
.checkbox{{display:flex;gap:8px;align-items:flex-start}}.check{{width:16px;height:16px;border:1.5px solid var(--muted);border-radius:3px;margin-top:4px;flex:none}}
.checkbox.checked .check{{background:#2383e2;border-color:#2383e2;color:#fff;text-align:center;font-size:11px;line-height:16px}}
.checkbox.checked .label{{text-decoration:line-through;opacity:.6}}.toggle{{font-weight:600}}
.page-link{{display:flex;gap:8px;align-items:center;padding:3px 0;color:var(--text);text-decoration:underline;text-decoration-color:var(--line)}}
footer{{color:var(--muted);font-size:12px;margin-top:64px;border-top:1px solid var(--line);padding-top:16px}}
</style></head><body><main><h1>{}</h1>{}<footer>Exported from IdeaCraft</footer></main></body></html>"#,
        html_escape(title),
        html_escape(title),
        body
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn render_html_block(out: &mut String, b: &Block, all: &[Block]) {
    match b.block_type.as_str() {
        "heading1" => out.push_str(&format!("<h2>{}</h2>", b.html)),
        "heading2" => out.push_str(&format!("<h3>{}</h3>", b.html)),
        "heading3" => out.push_str(&format!("<h4>{}</h4>", b.html)),
        "divider" => out.push_str("<hr>"),
        "quote" => out.push_str(&format!("<blockquote>{}</blockquote>", b.html)),
        "code" => out.push_str(&format!(
            "<pre><code>{}</code></pre>",
            b.html
        )),
        "callout" => out.push_str(&format!(
            "<div class=\"callout\"><span>{}</span><div>{}</div></div>",
            b.props.get("icon").and_then(|v| v.as_str()).unwrap_or("💡"),
            b.html
        )),
        "to_do" => {
            let checked = b.props.get("checked").and_then(|v| v.as_bool()).unwrap_or(false);
            out.push_str(&format!(
                "<div class=\"checkbox{}\"><span class=\"check\">{}</span><span class=\"label\">{}</span></div>",
                if checked { " checked" } else { "" },
                if checked { "✓" } else { "" },
                b.html
            ));
        }
        "bulleted_list_item" => out.push_str(&format!("<ul><li>{}</li></ul>", b.html)),
        "numbered_list_item" => out.push_str(&format!("<ol><li>{}</li></ol>", b.html)),
        "toggle" => out.push_str(&format!("<p class=\"toggle\">▸ {}</p>", b.html)),
        "image" => {
            let src = b.props.get("src").and_then(|v| v.as_str()).unwrap_or("");
            out.push_str(&format!("<img src=\"{}\" alt=\"\">", html_escape(src)));
        }
        "page_link" => out.push_str(&format!(
            "<div class=\"page-link\">📄 <span>{}</span></div>",
            b.text
        )),
        "table" => {
            out.push_str("<table>");
            if let Some(rows) = b.props.get("rows").and_then(|r| r.as_array()) {
                for row in rows {
                    out.push_str("<tr>");
                    if let Some(cells) = row.as_array() {
                        for c in cells {
                            out.push_str(&format!("<td>{}</td>", html_escape(c.as_str().unwrap_or(""))));
                        }
                    }
                    out.push_str("</tr>");
                }
            }
            out.push_str("</table>");
        }
        _ => {
            if !b.html.is_empty() {
                out.push_str(&format!("<p>{}</p>", b.html));
            }
        }
    }
    for child in all.iter().filter(|c| c.parent_id.as_deref() == Some(&b.id)) {
        render_html_block(out, child, all);
    }
}

pub fn parse_markdown(text: &str) -> (String, Vec<Block>) {
    let t = now();
    let mut title = String::new();
    let mut blocks: Vec<Block> = Vec::new();
    let mut in_code = false;
    let mut code_lang = String::new();
    let mut code_buf = String::new();
    let mut table_buf: Vec<Vec<String>> = Vec::new();
    let mut pos = 0.0;
    let mut seen_title = false;

    let push = |blocks: &mut Vec<Block>, ty: &str, html: String, text: String, props: Value, pos: &mut f64| {
        *pos += 1.0;
        blocks.push(Block {
            id: new_id(),
            page_id: String::new(),
            parent_id: None,
            block_type: ty.into(),
            html,
            text,
            props,
            position: *pos,
            created_at: t.clone(),
            updated_at: t.clone(),
        });
    };

    let inline = |s: &str| -> String {
        let mut x = html_escape(s);
        let re_code = Regex::new(r"`([^`]+)`").unwrap();
        x = re_code.replace_all(&x, "<code>$1</code>").to_string();
        let re_bold = Regex::new(r"\*\*([^*]+)\*\*").unwrap();
        x = re_bold.replace_all(&x, "<strong>$1</strong>").to_string();
        let re_ital = Regex::new(r"(^|[^*])\*([^*]+)\*").unwrap();
        x = re_ital.replace_all(&x, "$1<em>$2</em>").to_string();
        let re_strike = Regex::new(r"~~([^~]+)~~").unwrap();
        x = re_strike.replace_all(&x, "<s>$1</s>").to_string();
        let re_link = Regex::new(r"\[([^\]]+)\]\(([^)]+)\)").unwrap();
        x = re_link.replace_all(&x, "<a href=\"$2\">$1</a>").to_string();
        x
    };

    for raw in text.lines() {
        let line = raw.trim_end();
        if in_code {
            if line.trim_start().starts_with("```") {
                in_code = false;
                let html = html_escape(&code_buf).replace('\n', "<br>");
                push(
                    &mut blocks,
                    "code",
                    html,
                    code_buf.trim_end().to_string(),
                    json!({ "language": code_lang }),
                    &mut pos,
                );
                code_buf.clear();
                code_lang.clear();
            } else {
                code_buf.push_str(raw);
                code_buf.push('\n');
            }
            continue;
        }
        if line.trim_start().starts_with("```") {
            if !table_buf.is_empty() {
                let rows = std::mem::take(&mut table_buf);
                let text = rows.iter().flatten().cloned().collect::<Vec<_>>().join(" ");
                push(&mut blocks, "table", String::new(), text, json!({"header":true,"rows":rows}), &mut pos);
            }
            in_code = true;
            code_lang = line.trim().trim_start_matches('`').trim().to_string();
            continue;
        }
        if line.trim().starts_with('|') && line.trim().ends_with('|') {
            let cells: Vec<String> = line
                .trim()
                .trim_matches('|')
                .split('|')
                .map(|c| c.trim().trim_matches(':').trim().to_string())
                .collect();
            if cells.iter().all(|c| c.chars().all(|ch| ch == '-')) && !cells.is_empty() {
                continue;
            }
            table_buf.push(cells);
            continue;
        } else if !table_buf.is_empty() {
            let rows = std::mem::take(&mut table_buf);
            let text = rows.iter().flatten().cloned().collect::<Vec<_>>().join(" ");
            push(&mut blocks, "table", String::new(), text, json!({"header":true,"rows":rows}), &mut pos);
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !seen_title && trimmed.starts_with("# ") {
            title = trimmed[2..].trim().to_string();
            seen_title = true;
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("### ") {
            push(&mut blocks, "heading2", inline(rest), rest.to_string(), json!({}), &mut pos);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("#### ") {
            push(&mut blocks, "heading3", inline(rest), rest.to_string(), json!({}), &mut pos);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("## ") {
            push(&mut blocks, "heading1", inline(rest), rest.to_string(), json!({}), &mut pos);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("# ") {
            push(&mut blocks, "heading1", inline(rest), rest.to_string(), json!({}), &mut pos);
            continue;
        }
        if trimmed == "---" || trimmed == "***" || trimmed == "___" {
            push(&mut blocks, "divider", String::new(), String::new(), json!({}), &mut pos);
            continue;
        }
        if trimmed.starts_with("- [ ] ") || trimmed.starts_with("- [x] ") || trimmed.starts_with("- [X] ") {
            let checked = trimmed.starts_with("- [x]") || trimmed.starts_with("- [X]");
            let rest = &trimmed[6..];
            push(&mut blocks, "to_do", inline(rest), rest.to_string(), json!({"checked":checked}), &mut pos);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("- ") {
            push(&mut blocks, "bulleted_list_item", inline(rest), rest.to_string(), json!({}), &mut pos);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("* ") {
            push(&mut blocks, "bulleted_list_item", inline(rest), rest.to_string(), json!({}), &mut pos);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("> ") {
            push(&mut blocks, "quote", inline(rest), rest.to_string(), json!({}), &mut pos);
            continue;
        }
        let re_num = Regex::new(r"^\d+\.\s+(.*)$").unwrap();
        if let Some(caps) = re_num.captures(trimmed) {
            let rest = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            push(&mut blocks, "numbered_list_item", inline(rest), rest.to_string(), json!({}), &mut pos);
            continue;
        }
        let re_image = Regex::new(r"^!\[([^\]]*)\]\(([^)]+)\)$").unwrap();
        if let Some(caps) = re_image.captures(trimmed) {
            let alt = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let src = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            push(
                &mut blocks,
                "image",
                String::new(),
                alt.to_string(),
                json!({ "src": src, "caption": alt }),
                &mut pos,
            );
            continue;
        }
        push(&mut blocks, "paragraph", inline(trimmed), trimmed.to_string(), json!({}), &mut pos);
    }
    if in_code && !code_buf.is_empty() {
        let html = html_escape(&code_buf).replace('\n', "<br>");
        push(
            &mut blocks,
            "code",
            html,
            code_buf.trim_end().to_string(),
            json!({ "language": code_lang }),
            &mut pos,
        );
    }
    if !table_buf.is_empty() {
        let rows = std::mem::take(&mut table_buf);
        let text = rows.iter().flatten().cloned().collect::<Vec<_>>().join(" ");
        push(&mut blocks, "table", String::new(), text, json!({"header":true,"rows":rows}), &mut pos);
    }
    if title.is_empty() {
        title = "Imported page".into();
    }
    (title, blocks)
}

pub fn backup_json(conn: &Connection) -> Result<Value, String> {
    let workspace = get_workspace(conn).ok();
    let pages: Vec<Value> = {
        let mut stmt = conn
            .prepare(&format!("SELECT {} FROM pages", PAGE_COLS))
            .map_err(|e| e.to_string())?;
        let rows: Vec<Value> = stmt.query_map([], page_from_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .map(|p| serde_json::to_value(&p).unwrap_or(Value::Null))
            .collect();
        rows
    };
    let blocks: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT * FROM blocks")
            .map_err(|e| e.to_string())?;
        let rows: Vec<Value> = stmt.query_map([], block_from_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .map(|b| serde_json::to_value(&b).unwrap_or(Value::Null))
            .collect();
        rows
    };
    let databases: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT * FROM databases")
            .map_err(|e| e.to_string())?;
        let rows: Vec<Value> = stmt.query_map([], database_from_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .map(|d| {
                json!({
                    "id": d.id, "pageId": d.page_id, "name": d.name,
                    "properties": d.properties, "views": d.views,
                    "createdAt": d.created_at, "updatedAt": d.updated_at
                })
            })
            .collect();
        rows
    };
    let rows: Vec<Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT r.*, p.title AS title, p.icon AS icon, p.trashed_at AS trashed_at
                 FROM db_rows r JOIN pages p ON p.id=r.page_id",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<Value> = stmt.query_map([], db_row_from_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .map(|r| {
                json!({
                    "id": r.id, "databaseId": r.database_id, "pageId": r.page_id,
                    "values": r.values, "position": r.position,
                    "createdAt": r.created_at, "updatedAt": r.updated_at
                })
            })
            .collect();
        rows
    };
    let comments: Vec<Value> = {
        let mut stmt = conn
            .prepare("SELECT * FROM comments ORDER BY created_at, rowid")
            .map_err(|e| e.to_string())?;
        let rows: Vec<Value> = stmt
            .query_map([], |r| {
                Ok(Comment {
                    id: r.get("id")?,
                    page_id: r.get("page_id")?,
                    block_id: r.get("block_id")?,
                    html: r.get("html")?,
                    author: r.get("author")?,
                    created_at: r.get("created_at")?,
                    resolved: r.get::<_, i64>("resolved")? != 0,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .map(|c| serde_json::to_value(&c).unwrap_or(Value::Null))
            .collect();
        rows
    };
    let settings = {
        let mut map = serde_json::Map::new();
        if let Ok(mut stmt) = conn.prepare("SELECT key,value FROM settings") {
            if let Ok(rs) = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            }) {
                for (k, v) in rs.flatten() {
                    if k == "tabsState" || k == "windowState" {
                        continue;
                    }
                    if let Ok(val) = serde_json::from_str(&v) {
                        map.insert(k, val);
                    }
                }
            }
        }
        Value::Object(map)
    };
    Ok(json!({
        "format": "ideacraft-backup",
        "version": 1,
        "exportedAt": now(),
        "workspace": workspace,
        "pages": pages,
        "blocks": blocks,
        "databases": databases,
        "rows": rows,
        "comments": comments,
        "settings": settings
    }))
}

fn payload(data: &Value) -> &Value {
    data.get("data").unwrap_or(data)
}

pub fn restore_backup(conn: &mut Connection, data: &Value, replace: bool) -> Result<Value, String> {
    use std::collections::{HashMap, HashSet};
    let d = payload(data);
    let pages = d.get("pages").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let blocks = d.get("blocks").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let dbs = d.get("databases").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let rows = d.get("rows").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let comments = d.get("comments").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if replace {
        tx.execute_batch("DELETE FROM blocks; DELETE FROM databases; DELETE FROM db_rows; DELETE FROM comments; DELETE FROM snapshots; DELETE FROM recents; DELETE FROM pages;")
            .map_err(|e| e.to_string())?;
    }

    let mut remote_blocks: Vec<Block> = Vec::new();
    let mut blocks_by_page: HashMap<String, Vec<Block>> = HashMap::new();
    for b in blocks {
        if let Ok(block) = serde_json::from_value::<Block>(b) {
            blocks_by_page
                .entry(block.page_id.clone())
                .or_default()
                .push(block.clone());
            remote_blocks.push(block);
        }
    }

    let mut pages_added = 0;
    let mut pages_updated = 0;
    let mut replaced_pages: HashSet<String> = HashSet::new();
    let mut remote_page_ids: HashSet<String> = HashSet::new();
    for p in pages {
        if let Ok(page) = serde_json::from_value::<Page>(p) {
            remote_page_ids.insert(page.id.clone());
            let local_updated: Option<String> = tx
                .query_row(
                    "SELECT updated_at FROM pages WHERE id=?1",
                    params![page.id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            match local_updated {
                None => {
                    insert_page(&tx, &page)?;
                    pages_added += 1;
                    replaced_pages.insert(page.id.clone());
                }
                Some(local) if replace || page.updated_at > local => {
                    tx.execute(
                        "UPDATE pages SET parent_id=?1,title=?2,icon=?3,cover=?4,cover_type=?5,
                         cover_position=?6,type=?7,database_id=?8,position=?9,is_favorite=?10,
                         is_template=?11,locked=?12,font=?13,small_text=?14,full_width=?15,
                         updated_at=?16,trashed_at=?17,last_edited_by=?18 WHERE id=?19",
                        params![
                            page.parent_id,
                            page.title,
                            page.icon,
                            page.cover,
                            page.cover_type,
                            page.cover_position,
                            page.page_type,
                            page.database_id,
                            page.position,
                            page.is_favorite as i64,
                            page.is_template as i64,
                            page.locked as i64,
                            page.font,
                            page.small_text as i64,
                            page.full_width as i64,
                            page.updated_at,
                            page.trashed_at,
                            page.last_edited_by,
                            page.id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    pages_updated += 1;
                    replaced_pages.insert(page.id.clone());
                }
                _ => {}
            }
        }
    }

    // A newer page wins as a whole, so block additions, edits and deletions all travel together.
    for pid in &replaced_pages {
        tx.execute("DELETE FROM blocks WHERE page_id=?1", params![pid])
            .map_err(|e| e.to_string())?;
        if let Some(list) = blocks_by_page.get(pid) {
            for block in list {
                insert_block(&tx, block)?;
            }
        }
    }
    for block in &remote_blocks {
        if remote_page_ids.contains(&block.page_id) {
            continue;
        }
        let exists: bool = tx
            .query_row("SELECT 1 FROM blocks WHERE id=?1", params![block.id], |_| Ok(true))
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        if !exists {
            insert_block(&tx, block)?;
        }
    }

    for db in dbs {
        let id = db.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let remote_updated = db.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
        let local_updated: Option<String> = tx
            .query_row("SELECT updated_at FROM databases WHERE id=?1", params![id], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        match local_updated {
            None => {
                tx.execute(
                    "INSERT INTO databases(id,page_id,name,properties,views,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        id,
                        db.get("pageId").and_then(|v| v.as_str()).unwrap_or(""),
                        db.get("name").and_then(|v| v.as_str()).unwrap_or("Database"),
                        serde_json::to_string(db.get("properties").unwrap_or(&json!([]))).unwrap(),
                        serde_json::to_string(db.get("views").unwrap_or(&json!([]))).unwrap(),
                        db.get("createdAt").and_then(|v| v.as_str()).unwrap_or(&now()),
                        remote_updated
                    ],
                )
                .ok();
            }
            Some(local) if replace || remote_updated > local.as_str() => {
                tx.execute(
                    "UPDATE databases SET name=?1,properties=?2,views=?3,updated_at=?4 WHERE id=?5",
                    params![
                        db.get("name").and_then(|v| v.as_str()).unwrap_or("Database"),
                        serde_json::to_string(db.get("properties").unwrap_or(&json!([]))).unwrap(),
                        serde_json::to_string(db.get("views").unwrap_or(&json!([]))).unwrap(),
                        remote_updated,
                        id
                    ],
                )
                .ok();
            }
            _ => {}
        }
    }

    for r in rows {
        let id = r.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let remote_updated = r.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
        let local_updated: Option<String> = tx
            .query_row("SELECT updated_at FROM db_rows WHERE id=?1", params![id], |x| x.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        match local_updated {
            None => {
                tx.execute(
                    "INSERT INTO db_rows(id,database_id,page_id,values_json,position,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        id,
                        r.get("databaseId").and_then(|v| v.as_str()).unwrap_or(""),
                        r.get("pageId").and_then(|v| v.as_str()).unwrap_or(""),
                        serde_json::to_string(r.get("values").unwrap_or(&json!({}))).unwrap(),
                        r.get("position").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        r.get("createdAt").and_then(|v| v.as_str()).unwrap_or(&now()),
                        remote_updated
                    ],
                )
                .ok();
            }
            Some(local) if replace || remote_updated > local.as_str() => {
                tx.execute(
                    "UPDATE db_rows SET values_json=?1,position=?2,updated_at=?3 WHERE id=?4",
                    params![
                        serde_json::to_string(r.get("values").unwrap_or(&json!({}))).unwrap(),
                        r.get("position").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        remote_updated,
                        id
                    ],
                )
                .ok();
            }
            _ => {}
        }
    }

    for c in comments {
        if let Ok(comment) = serde_json::from_value::<Comment>(c) {
            let exists: bool = tx
                .query_row("SELECT 1 FROM comments WHERE id=?1", params![comment.id], |_| Ok(true))
                .optional()
                .map_err(|e| e.to_string())?
                .unwrap_or(false);
            if exists {
                tx.execute(
                    "UPDATE comments SET html=?1,resolved=?2 WHERE id=?3",
                    params![comment.html, comment.resolved as i64, comment.id],
                )
                .ok();
            } else {
                tx.execute(
                    "INSERT INTO comments(id,page_id,block_id,html,author,created_at,resolved) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        comment.id,
                        comment.page_id,
                        comment.block_id,
                        comment.html,
                        comment.author,
                        comment.created_at,
                        comment.resolved as i64
                    ],
                )
                .ok();
            }
        }
    }

    if let Some(ws) = d.get("workspace") {
        if let (Some(name), Some(icon)) = (
            ws.get("name").and_then(|v| v.as_str()),
            ws.get("icon").and_then(|v| v.as_str()),
        ) {
            if replace {
                let id = ws.get("id").and_then(|v| v.as_str()).unwrap_or("ws-ideacraft");
                tx.execute("DELETE FROM workspace", []).ok();
                tx.execute(
                    "INSERT INTO workspace(id,name,icon,created_at) VALUES(?1,?2,?3,?4)",
                    params![id, name, icon, now()],
                )
                .ok();
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({
        "pagesAdded": pages_added,
        "pagesUpdated": pages_updated,
        "replaced": replace
    }))
}

pub fn merge_backup(conn: &mut Connection, remote: &Value) -> Result<Value, String> {
    restore_backup(conn, remote, false)
}
