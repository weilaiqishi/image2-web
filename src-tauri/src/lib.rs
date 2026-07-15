use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use keyring::Entry;
use reqwest::{multipart, Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{Manager, State};
use tokio::sync::Mutex;
use url::Url;
use uuid::Uuid;

const KEYRING_SERVICE: &str = "com.image2.studio";
const KEYRING_USER: &str = "openai-api-key";

#[derive(Debug, thiserror::Error)]
enum StudioError {
    #[error("{0}")]
    Message(String),
    #[error("File operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid stored data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Network request failed: {0}")]
    Network(#[from] reqwest::Error),
}

impl Serialize for StudioError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, StudioError>;

#[derive(Clone)]
struct AppState {
    client: Client,
    data_dir: PathBuf,
    history: Arc<Mutex<Vec<AssetRecord>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct SettingsFile {
    base_url: String,
    agent_protocol: String,
    agent_model: String,
    image_model: String,
}

impl Default for SettingsFile {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".into(),
            agent_protocol: "responses".into(),
            agent_model: "gpt-5.6".into(),
            image_model: "gpt-image-2".into(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsPublic {
    base_url: String,
    agent_protocol: String,
    agent_model: String,
    image_model: String,
    has_api_key: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSettingsInput {
    base_url: String,
    agent_protocol: String,
    agent_model: String,
    image_model: String,
    api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetRecord {
    id: String,
    file_path: String,
    mime_type: String,
    prompt: String,
    created_at: String,
    width: Option<u32>,
    height: Option<u32>,
    parent_id: Option<String>,
    kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateInput {
    prompt: String,
    size: String,
    quality: String,
    output_format: String,
    reference_data_urls: Option<Vec<String>>,
    reference_asset_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProxyAgentInput {
    protocol: String,
    body: serde_json::Value,
}

fn agent_endpoint(protocol: &str) -> Result<&'static str> {
    match protocol {
        "responses" => Ok("responses"),
        "chat_completions" => Ok("chat/completions"),
        _ => Err(StudioError::Message("Agent 协议不受支持".into())),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditInput {
    prompt: String,
    size: String,
    quality: String,
    output_format: String,
    original_asset_id: String,
    annotated_data_url: String,
    annotation_prompt: String,
}

#[derive(Debug, Deserialize)]
struct ImageResponse {
    data: Vec<ImageDatum>,
}

#[derive(Debug, Deserialize)]
struct ImageDatum {
    b64_json: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnnotationDocument {
    asset_id: String,
    json: String,
    updated_at: String,
}

fn settings_path(state: &AppState) -> PathBuf {
    state.data_dir.join("settings.json")
}

fn history_path(state: &AppState) -> PathBuf {
    state.data_dir.join("history.json")
}

fn load_settings(state: &AppState) -> Result<SettingsFile> {
    let path = settings_path(state);
    if !path.exists() {
        return Ok(SettingsFile::default());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let temp = path.with_extension("tmp");
    fs::write(&temp, serde_json::to_vec_pretty(value)?)?;
    fs::rename(temp, path)?;
    Ok(())
}

fn validate_base_url(value: &str) -> Result<String> {
    let normalized = value.trim().trim_end_matches('/');
    let parsed =
        Url::parse(normalized).map_err(|_| StudioError::Message("Base URL 格式不正确".into()))?;
    if parsed.scheme() != "https"
        && !(parsed.scheme() == "http"
            && matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1")))
    {
        return Err(StudioError::Message(
            "Base URL 必须使用 HTTPS；只有本机服务可使用 HTTP".into(),
        ));
    }
    Ok(normalized.to_string())
}

fn keyring_entry() -> Result<Entry> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| StudioError::Message(format!("无法访问系统凭证库: {error}")))
}

fn has_api_key() -> bool {
    keyring_entry()
        .and_then(|entry| {
            entry
                .get_password()
                .map_err(|error| StudioError::Message(error.to_string()))
        })
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn read_api_key() -> Result<String> {
    keyring_entry()?
        .get_password()
        .map_err(|_| StudioError::Message("尚未配置 OpenAI API Key".into()))
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<SettingsPublic> {
    let settings = load_settings(&state)?;
    Ok(SettingsPublic {
        base_url: settings.base_url,
        agent_protocol: settings.agent_protocol,
        agent_model: settings.agent_model,
        image_model: settings.image_model,
        has_api_key: has_api_key(),
    })
}

#[tauri::command]
async fn save_settings(
    input: SaveSettingsInput,
    state: State<'_, AppState>,
) -> Result<SettingsPublic> {
    let settings = SettingsFile {
        base_url: validate_base_url(&input.base_url)?,
        agent_protocol: input.agent_protocol.trim().to_string(),
        agent_model: input.agent_model.trim().to_string(),
        image_model: input.image_model.trim().to_string(),
    };
    if !matches!(settings.agent_protocol.as_str(), "responses" | "chat_completions") {
        return Err(StudioError::Message("Agent 协议不受支持".into()));
    }
    if settings.agent_model.is_empty() || settings.image_model.is_empty() {
        return Err(StudioError::Message("Agent 与图片模型名称不能为空".into()));
    }
    if let Some(api_key) = input.api_key.filter(|key| !key.trim().is_empty()) {
        keyring_entry()?
            .set_password(api_key.trim())
            .map_err(|error| StudioError::Message(format!("保存密钥失败: {error}")))?;
    }
    atomic_json(&settings_path(&state), &settings)?;
    Ok(SettingsPublic {
        base_url: settings.base_url,
        agent_protocol: settings.agent_protocol,
        agent_model: settings.agent_model,
        image_model: settings.image_model,
        has_api_key: has_api_key(),
    })
}

#[tauri::command]
async fn proxy_agent(input: ProxyAgentInput, state: State<'_, AppState>) -> Result<serde_json::Value> {
    let endpoint = agent_endpoint(&input.protocol)?;
    let settings = load_settings(&state)?;
    let response = state.client
        .post(format!("{}/{endpoint}", settings.base_url))
        .bearer_auth(read_api_key()?)
        .json(&input.body)
        .send()
        .await?;
    let status = response.status();
    let request_id = response.headers().get("x-request-id").and_then(|value| value.to_str().ok()).unwrap_or_default().to_string();
    let body: serde_json::Value = response.json().await.unwrap_or_default();
    if !status.is_success() {
        let message = body.pointer("/error/message").and_then(|value| value.as_str()).unwrap_or("Agent 服务返回错误");
        let prefix = match status {
            StatusCode::UNAUTHORIZED => "API Key 无效",
            StatusCode::TOO_MANY_REQUESTS => "请求过于频繁或额度不足",
            status if status.is_server_error() => "Agent 服务暂时不可用",
            _ => message,
        };
        return Err(StudioError::Message(if request_id.is_empty() { prefix.into() } else { format!("{prefix}（请求 {request_id}）") }));
    }
    Ok(body)
}

fn decode_data_url(value: &str) -> Result<(Vec<u8>, String)> {
    let (meta, data) = value
        .split_once(',')
        .ok_or_else(|| StudioError::Message("图片数据格式不正确".into()))?;
    let mime = meta
        .strip_prefix("data:")
        .and_then(|part| part.split(';').next())
        .unwrap_or("image/png")
        .to_string();
    let bytes = BASE64
        .decode(data)
        .map_err(|_| StudioError::Message("无法解析图片数据".into()))?;
    Ok((bytes, mime))
}

fn extension_for(format: &str) -> (&'static str, &'static str) {
    match format {
        "jpeg" | "jpg" => ("jpg", "image/jpeg"),
        "webp" => ("webp", "image/webp"),
        _ => ("png", "image/png"),
    }
}

async fn parse_image_response(response: reqwest::Response) -> Result<(Vec<u8>, String)> {
    let status = response.status();
    if !status.is_success() {
        let request_id = response
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let body: serde_json::Value = response.json().await.unwrap_or_default();
        let message = body
            .pointer("/error/message")
            .and_then(|value| value.as_str())
            .unwrap_or("图片服务返回错误");
        let prefix = match status {
            StatusCode::UNAUTHORIZED => "API Key 无效",
            StatusCode::TOO_MANY_REQUESTS => "请求过于频繁或额度不足",
            status if status.is_server_error() => "图片服务暂时不可用",
            _ => message,
        };
        return Err(StudioError::Message(if request_id.is_empty() {
            prefix.to_string()
        } else {
            format!("{prefix}（请求 {request_id}）")
        }));
    }

    let payload: ImageResponse = response.json().await?;
    let image = payload
        .data
        .into_iter()
        .next()
        .ok_or_else(|| StudioError::Message("图片服务没有返回结果".into()))?;
    if let Some(base64) = image.b64_json {
        let bytes = BASE64
            .decode(base64)
            .map_err(|_| StudioError::Message("无法解析生成图片".into()))?;
        return Ok((bytes, "application/octet-stream".into()));
    }
    if let Some(url) = image.url {
        let downloaded = Client::new().get(url).send().await?.error_for_status()?;
        let mime = downloaded
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("image/png")
            .to_string();
        return Ok((downloaded.bytes().await?.to_vec(), mime));
    }
    Err(StudioError::Message("图片响应缺少图像数据".into()))
}

async fn save_generated_asset(
    state: &AppState,
    bytes: Vec<u8>,
    requested_format: &str,
    response_mime: &str,
    prompt: String,
    parent_id: Option<String>,
    kind: &str,
) -> Result<AssetRecord> {
    let (extension, default_mime) = extension_for(requested_format);
    let id = Uuid::new_v4().to_string();
    let file_path = state
        .data_dir
        .join("assets")
        .join(format!("{id}.{extension}"));
    fs::write(&file_path, bytes)?;
    let record = AssetRecord {
        id,
        file_path: file_path.to_string_lossy().to_string(),
        mime_type: if response_mime.starts_with("image/") {
            response_mime.to_string()
        } else {
            default_mime.into()
        },
        prompt,
        created_at: Utc::now().to_rfc3339(),
        width: None,
        height: None,
        parent_id,
        kind: kind.into(),
    };
    let mut history = state.history.lock().await;
    history.insert(0, record.clone());
    atomic_json(&history_path(state), &*history)?;
    Ok(record)
}

async fn send_generation_request(
    state: &AppState,
    settings: &SettingsFile,
    api_key: &str,
    input: &GenerateInput,
) -> Result<(Vec<u8>, String)> {
    let references = input.reference_data_urls.as_deref().unwrap_or_default();
    let asset_ids = input.reference_asset_ids.as_deref().unwrap_or_default();
    if references.is_empty() && asset_ids.is_empty() {
        let response = state
            .client
            .post(format!("{}/images/generations", settings.base_url))
            .bearer_auth(api_key)
            .json(&serde_json::json!({
                "model": settings.image_model,
                "prompt": input.prompt,
                "size": input.size,
                "quality": input.quality,
                "output_format": input.output_format,
                "n": 1
            }))
            .send()
            .await?;
        return parse_image_response(response).await;
    }

    let mut form = multipart::Form::new()
        .text("model", settings.image_model.clone())
        .text("prompt", input.prompt.clone())
        .text("size", input.size.clone())
        .text("quality", input.quality.clone())
        .text("output_format", input.output_format.clone());
    for (index, data_url) in references.iter().enumerate() {
        let (bytes, mime) = decode_data_url(data_url)?;
        let part = multipart::Part::bytes(bytes)
            .file_name(format!("reference-{index}.png"))
            .mime_str(&mime)
            .map_err(|error| StudioError::Message(error.to_string()))?;
        form = form.part("image[]", part);
    }
    if !asset_ids.is_empty() {
        let history = state.history.lock().await;
        for (index, asset_id) in asset_ids.iter().enumerate() {
            let asset = history.iter().find(|asset| &asset.id == asset_id).ok_or_else(|| StudioError::Message("找不到参考图片".into()))?;
            let part = multipart::Part::bytes(fs::read(&asset.file_path)?)
                .file_name(format!("asset-reference-{index}.png"))
                .mime_str(&asset.mime_type)
                .map_err(|error| StudioError::Message(error.to_string()))?;
            form = form.part("image[]", part);
        }
    }
    let response = state
        .client
        .post(format!("{}/images/edits", settings.base_url))
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await?;
    parse_image_response(response).await
}

#[tauri::command]
async fn generate_image(input: GenerateInput, state: State<'_, AppState>) -> Result<AssetRecord> {
    if input.prompt.trim().is_empty() {
        return Err(StudioError::Message("请输入图片描述".into()));
    }
    let settings = load_settings(&state)?;
    let api_key = read_api_key()?;
    let (bytes, mime) = send_generation_request(&state, &settings, &api_key, &input).await?;
    save_generated_asset(
        &state,
        bytes,
        &input.output_format,
        &mime,
        input.prompt,
        None,
        "generated",
    )
    .await
}

#[tauri::command]
async fn edit_image(input: EditInput, state: State<'_, AppState>) -> Result<AssetRecord> {
    let original = {
        let history = state.history.lock().await;
        history
            .iter()
            .find(|asset| asset.id == input.original_asset_id)
            .cloned()
            .ok_or_else(|| StudioError::Message("找不到原始图片".into()))?
    };
    let original_bytes = fs::read(&original.file_path)?;
    let (annotated_bytes, annotated_mime) = decode_data_url(&input.annotated_data_url)?;
    let settings = load_settings(&state)?;
    let api_key = read_api_key()?;
    let combined_prompt = format!(
        "第一张图是必须保留主体和整体风格的干净原图。第二张图包含用户用圆圈、箭头和文字做的修改标注。请按照标注和以下要求修改原图：{}。输出最终干净图片，不要保留任何标注线、箭头、圈选框或说明文字。",
        input.annotation_prompt.trim()
    );
    let original_mime = original.mime_type.clone();
    let original_part = multipart::Part::bytes(original_bytes)
        .file_name("original.png")
        .mime_str(&original_mime)
        .map_err(|error| StudioError::Message(error.to_string()))?;
    let annotated_part = multipart::Part::bytes(annotated_bytes)
        .file_name("annotated.png")
        .mime_str(&annotated_mime)
        .map_err(|error| StudioError::Message(error.to_string()))?;
    let form = multipart::Form::new()
        .text("model", settings.image_model)
        .text("prompt", combined_prompt)
        .text("size", input.size.clone())
        .text("quality", input.quality.clone())
        .text("output_format", input.output_format.clone())
        .part("image[]", original_part)
        .part("image[]", annotated_part);
    let response = state
        .client
        .post(format!("{}/images/edits", settings.base_url))
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await?;
    let (bytes, mime) = parse_image_response(response).await?;
    save_generated_asset(
        &state,
        bytes,
        &input.output_format,
        &mime,
        input.prompt,
        Some(original.id),
        "edited",
    )
    .await
}

#[tauri::command]
async fn list_assets(state: State<'_, AppState>) -> Result<Vec<AssetRecord>> {
    Ok(state.history.lock().await.clone())
}

#[tauri::command]
async fn read_asset_data_url(asset_id: String, state: State<'_, AppState>) -> Result<String> {
    let history = state.history.lock().await;
    let asset = history.iter().find(|asset| asset.id == asset_id).ok_or_else(|| StudioError::Message("找不到图片".into()))?;
    Ok(format!("data:{};base64,{}", asset.mime_type, BASE64.encode(fs::read(&asset.file_path)?)))
}

#[tauri::command]
async fn delete_asset(asset_id: String, state: State<'_, AppState>) -> Result<()> {
    let mut history = state.history.lock().await;
    if let Some(index) = history.iter().position(|asset| asset.id == asset_id) {
        let asset = history.remove(index);
        let _ = fs::remove_file(asset.file_path);
        atomic_json(&history_path(&state), &*history)?;
    }
    Ok(())
}

#[tauri::command]
async fn export_asset(asset_id: String, state: State<'_, AppState>) -> Result<bool> {
    let asset = {
        let history = state.history.lock().await;
        history
            .iter()
            .find(|asset| asset.id == asset_id)
            .cloned()
            .ok_or_else(|| StudioError::Message("找不到图片".into()))?
    };
    let extension = Path::new(&asset.file_path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    let selected = rfd::AsyncFileDialog::new()
        .set_file_name(format!("image2-{}.{}", &asset.id[..8], extension))
        .save_file()
        .await;
    if let Some(target) = selected {
        fs::copy(asset.file_path, target.path())?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
async fn save_annotation(asset_id: String, json: String, state: State<'_, AppState>) -> Result<()> {
    let document = AnnotationDocument {
        asset_id: asset_id.clone(),
        json,
        updated_at: Utc::now().to_rfc3339(),
    };
    let path = state
        .data_dir
        .join("annotations")
        .join(format!("{asset_id}.json"));
    atomic_json(&path, &document)
}

#[tauri::command]
async fn load_annotation(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<Option<AnnotationDocument>> {
    let path = state
        .data_dir
        .join("annotations")
        .join(format!("{asset_id}.json"));
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_slice(&fs::read(path)?)?))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(data_dir.join("assets"))?;
            fs::create_dir_all(data_dir.join("annotations"))?;
            let history: Vec<AssetRecord> = if data_dir.join("history.json").exists() {
                serde_json::from_slice(&fs::read(data_dir.join("history.json"))?)
                    .unwrap_or_default()
            } else {
                Vec::new()
            };
            app.manage(AppState {
                client: Client::builder()
                    .timeout(std::time::Duration::from_secs(180))
                    .build()?,
                data_dir,
                history: Arc::new(Mutex::new(history)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            proxy_agent,
            generate_image,
            edit_image,
            list_assets,
            read_asset_data_url,
            delete_asset,
            export_asset,
            save_annotation,
            load_annotation
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Image2 Studio");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_remote_https_and_local_http() {
        assert!(validate_base_url("https://api.openai.com/v1/").is_ok());
        assert!(validate_base_url("http://127.0.0.1:8080/v1").is_ok());
        assert!(validate_base_url("http://example.com/v1").is_err());
    }

    #[test]
    fn decodes_image_data_url() {
        let (bytes, mime) = decode_data_url("data:image/png;base64,aGVsbG8=").unwrap();
        assert_eq!(bytes, b"hello");
        assert_eq!(mime, "image/png");
    }

    #[test]
    fn restricts_agent_proxy_endpoints() {
        assert_eq!(agent_endpoint("responses").unwrap(), "responses");
        assert_eq!(agent_endpoint("chat_completions").unwrap(), "chat/completions");
        assert!(agent_endpoint("images/generations").is_err());
        assert!(agent_endpoint("https://example.com").is_err());
    }
}
