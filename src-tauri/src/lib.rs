use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use keyring::Entry;
use reqwest::{multipart, Client, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    error::Error as _,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::{Manager, State};
use tokio::sync::Mutex;
use url::Url;
use uuid::Uuid;

const KEYRING_SERVICE: &str = "com.image2.studio";
const KEYRING_USER: &str = "openai-api-key";
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(180);
const IMAGE_REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const CATALOG_BASE_URL: &str =
    "https://raw.githubusercontent.com/weilaiqishi/image2-web/main/public/prompt-catalog/";
const CATALOG_MANIFEST_URL: &str = "https://raw.githubusercontent.com/weilaiqishi/image2-web/main/public/prompt-catalog/catalog-manifest.json";

#[derive(Debug, thiserror::Error)]
enum StudioError {
    #[error("{0}")]
    Message(String),
    #[error("File operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid stored data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Network request failed: {0}")]
    Network(String),
}

impl From<reqwest::Error> for StudioError {
    fn from(error: reqwest::Error) -> Self {
        let category = if error.is_timeout() {
            "request timed out"
        } else if error.is_connect() {
            "connection failed"
        } else if error.is_decode() {
            "service returned an invalid response"
        } else if error.is_body() {
            "request or response body transfer failed"
        } else if error.is_request() {
            "request could not be sent"
        } else {
            "request failed"
        };
        let url = error.url().map(redacted_url);
        let mut causes = Vec::new();
        let mut source = error.source();
        while let Some(cause) = source {
            let detail = cause.to_string();
            if !detail.is_empty() && causes.last() != Some(&detail) {
                causes.push(detail);
            }
            source = cause.source();
        }
        let location = url
            .map(|value| format!(" for {value}"))
            .unwrap_or_default();
        let detail = if causes.is_empty() {
            String::new()
        } else {
            format!(": {}", causes.join(": "))
        };
        Self::Network(format!("{category}{location}{detail}"))
    }
}

fn redacted_url(url: &Url) -> String {
    let mut redacted = url.clone();
    redacted.set_query(None);
    redacted.set_fragment(None);
    redacted.to_string()
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
    lineage: Option<AssetLineage>,
    hidden_at: Option<String>,
    kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetLineage {
    parent_id: Option<String>,
    root_id: String,
    revision: u32,
    branch_label: Option<String>,
    source_task_id: Option<String>,
    source_document_id: Option<String>,
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
    parent_asset_id: Option<String>,
    source_task_id: Option<String>,
    source_document_id: Option<String>,
    branch_label: Option<String>,
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
    annotated_data_url: Option<String>,
    overlay_asset_id: Option<String>,
    mask_data_url: Option<String>,
    reference_asset_ids: Option<Vec<String>>,
    reference_data_urls: Option<Vec<String>>,
    source_task_id: Option<String>,
    source_document_id: Option<String>,
    branch_label: Option<String>,
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
    document_id: String,
    source_asset_id: String,
    json: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyAnnotationDocument {
    asset_id: String,
    json: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptCatalogDownload {
    manifest: serde_json::Value,
    items: Vec<serde_json::Value>,
    thumbnail_paths: HashMap<String, String>,
}

fn validate_catalog_url(value: &str) -> Result<Url> {
    let parsed =
        Url::parse(value).map_err(|_| StudioError::Message("灵感目录地址格式不正确".into()))?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("raw.githubusercontent.com")
        || !parsed
            .path()
            .starts_with("/weilaiqishi/image2-web/main/public/prompt-catalog/")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(StudioError::Message("灵感目录地址不在白名单中".into()));
    }
    Ok(parsed)
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn settings_path(state: &AppState) -> PathBuf {
    state.data_dir.join("settings.json")
}

fn history_path(state: &AppState) -> PathBuf {
    state.data_dir.join("history.json")
}

fn validate_local_id(value: &str, label: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(StudioError::Message(format!("{label} 格式不正确")));
    }
    Ok(())
}

fn annotation_path(state: &AppState, document_id: &str) -> Result<PathBuf> {
    validate_local_id(document_id, "标注文档 ID")?;
    Ok(state
        .data_dir
        .join("annotations")
        .join(format!("{document_id}.json")))
}

fn overlay_path(state: &AppState, document_id: &str, extension: &str) -> Result<PathBuf> {
    validate_local_id(document_id, "标注文档 ID")?;
    Ok(state
        .data_dir
        .join("annotation-overlays")
        .join(format!("{document_id}.{extension}")))
}

fn load_annotation_file(path: &Path, requested_id: &str) -> Result<AnnotationDocument> {
    let bytes = fs::read(path)?;
    if let Ok(document) = serde_json::from_slice::<AnnotationDocument>(&bytes) {
        return Ok(document);
    }
    let legacy: LegacyAnnotationDocument = serde_json::from_slice(&bytes)?;
    Ok(AnnotationDocument {
        document_id: requested_id.to_string(),
        source_asset_id: legacy.asset_id,
        json: legacy.json,
        updated_at: legacy.updated_at,
    })
}

fn find_overlay_path(state: &AppState, document_id: &str) -> Result<PathBuf> {
    for extension in ["png", "jpg", "webp"] {
        let path = overlay_path(state, document_id, extension)?;
        if path.exists() {
            return Ok(path);
        }
    }
    Err(StudioError::Message("找不到标注合成图".into()))
}

fn save_annotation_file(
    state: &AppState,
    document_id: &str,
    source_asset_id: &str,
    json: &str,
) -> Result<()> {
    validate_local_id(source_asset_id, "源资产 ID")?;
    let _: serde_json::Value = serde_json::from_str(json)?;
    let document = AnnotationDocument {
        document_id: document_id.to_string(),
        source_asset_id: source_asset_id.to_string(),
        json: json.to_string(),
        updated_at: Utc::now().to_rfc3339(),
    };
    atomic_json(&annotation_path(state, document_id)?, &document)
}

fn list_annotation_files(
    state: &AppState,
    source_asset_id: &str,
) -> Result<Vec<AnnotationDocument>> {
    validate_local_id(source_asset_id, "源资产 ID")?;
    let mut documents = Vec::new();
    for entry in fs::read_dir(state.data_dir.join("annotations"))? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some(document_id) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        if let Ok(document) = load_annotation_file(&path, document_id) {
            if document.source_asset_id == source_asset_id {
                documents.push(document);
            }
        }
    }
    documents.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(documents)
}

fn save_annotation_overlay_file(
    state: &AppState,
    document_id: &str,
    data_url: &str,
) -> Result<String> {
    let (bytes, mime) = decode_data_url(data_url)?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err(StudioError::Message("标注合成图文件过大".into()));
    }
    let extension = match mime.as_str() {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/png" => "png",
        _ => return Err(StudioError::Message("标注合成图格式不受支持".into())),
    };
    for old_extension in ["png", "jpg", "webp"] {
        let old_path = overlay_path(state, document_id, old_extension)?;
        if old_extension != extension && old_path.exists() {
            fs::remove_file(old_path)?;
        }
    }
    let path = overlay_path(state, document_id, extension)?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, bytes)?;
    fs::rename(temp, path)?;
    Ok(document_id.to_string())
}

fn delete_annotation_files(state: &AppState, document_id: &str) -> Result<()> {
    let path = annotation_path(state, document_id)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    for extension in ["png", "jpg", "webp"] {
        let overlay = overlay_path(state, document_id, extension)?;
        if overlay.exists() {
            fs::remove_file(overlay)?;
        }
    }
    Ok(())
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
    if !matches!(
        settings.agent_protocol.as_str(),
        "responses" | "chat_completions"
    ) {
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
async fn proxy_agent(
    input: ProxyAgentInput,
    state: State<'_, AppState>,
) -> Result<serde_json::Value> {
    let endpoint = agent_endpoint(&input.protocol)?;
    let settings = load_settings(&state)?;
    let response = state
        .client
        .post(format!("{}/{endpoint}", settings.base_url))
        .bearer_auth(read_api_key()?)
        .json(&input.body)
        .send()
        .await?;
    let status = response.status();
    let request_id = response
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let body: serde_json::Value = response.json().await.unwrap_or_default();
    if !status.is_success() {
        let message = body
            .pointer("/error/message")
            .and_then(|value| value.as_str())
            .unwrap_or("Agent 服务返回错误");
        let prefix = match status {
            StatusCode::UNAUTHORIZED => "API Key 无效",
            StatusCode::TOO_MANY_REQUESTS => "请求过于频繁或额度不足",
            status if status.is_server_error() => "Agent 服务暂时不可用",
            _ => message,
        };
        return Err(StudioError::Message(if request_id.is_empty() {
            prefix.into()
        } else {
            format!("{prefix}（请求 {request_id}）")
        }));
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
    source_task_id: Option<String>,
    source_document_id: Option<String>,
    branch_label: Option<String>,
) -> Result<AssetRecord> {
    let (extension, default_mime) = extension_for(requested_format);
    let id = Uuid::new_v4().to_string();
    let file_path = state
        .data_dir
        .join("assets")
        .join(format!("{id}.{extension}"));
    fs::write(&file_path, bytes)?;
    let (root_id, revision) = if let Some(parent_id) = parent_id.as_deref() {
        let history = state.history.lock().await;
        let parent = history.iter().find(|asset| asset.id == parent_id);
        (
            parent
                .and_then(|asset| {
                    asset
                        .lineage
                        .as_ref()
                        .map(|lineage| lineage.root_id.clone())
                })
                .unwrap_or_else(|| parent_id.to_string()),
            parent
                .and_then(|asset| asset.lineage.as_ref().map(|lineage| lineage.revision + 1))
                .unwrap_or(1),
        )
    } else {
        (id.clone(), 0)
    };
    let lineage = AssetLineage {
        parent_id: parent_id.clone(),
        root_id,
        revision,
        branch_label,
        source_task_id,
        source_document_id,
    };
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
        lineage: Some(lineage),
        hidden_at: None,
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
            .timeout(IMAGE_REQUEST_TIMEOUT)
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
            let asset = history
                .iter()
                .find(|asset| &asset.id == asset_id)
                .ok_or_else(|| StudioError::Message("找不到参考图片".into()))?;
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
        .timeout(IMAGE_REQUEST_TIMEOUT)
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
        input.prompt.clone(),
        input.parent_asset_id.clone(),
        "generated",
        input.source_task_id.clone(),
        input.source_document_id.clone(),
        input.branch_label.clone(),
    )
    .await
}

#[tauri::command]
async fn import_asset(
    data_url: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<AssetRecord> {
    let (bytes, mime) = decode_data_url(&data_url)?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err(StudioError::Message("导入图片文件过大".into()));
    }
    let format = match mime.as_str() {
        "image/jpeg" => "jpeg",
        "image/webp" => "webp",
        "image/png" => "png",
        _ => return Err(StudioError::Message("导入图片格式不受支持".into())),
    };
    save_generated_asset(
        &state, bytes, format, &mime, name, None, "imported", None, None, None,
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
    let (annotated_bytes, annotated_mime) =
        if let Some(data_url) = input.annotated_data_url.as_deref() {
            decode_data_url(data_url)?
        } else if let Some(overlay_id) = input.overlay_asset_id.as_deref() {
            let path = find_overlay_path(&state, overlay_id)?;
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("png");
            let mime = match extension {
                "jpg" => "image/jpeg",
                "webp" => "image/webp",
                _ => "image/png",
            };
            (fs::read(path)?, mime.to_string())
        } else {
            return Err(StudioError::Message("编辑任务缺少标注合成图".into()));
        };
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
    let mut form = multipart::Form::new()
        .text("model", settings.image_model)
        .text("prompt", combined_prompt)
        .text("size", input.size.clone())
        .text("quality", input.quality.clone())
        .text("output_format", input.output_format.clone())
        .part("image[]", original_part)
        .part("image[]", annotated_part);
    let reference_asset_ids = input.reference_asset_ids.as_deref().unwrap_or_default();
    let reference_data_urls = input.reference_data_urls.as_deref().unwrap_or_default();
    if reference_asset_ids.len() + reference_data_urls.len() > 6 {
        return Err(StudioError::Message("编辑任务最多支持 6 张参考图".into()));
    }
    if !reference_asset_ids.is_empty() {
        let history = state.history.lock().await;
        for asset_id in reference_asset_ids {
            let asset = history
                .iter()
                .find(|asset| &asset.id == asset_id)
                .ok_or_else(|| StudioError::Message("找不到参考图片".into()))?;
            let part = multipart::Part::bytes(fs::read(&asset.file_path)?)
                .file_name("reference.png")
                .mime_str(&asset.mime_type)
                .map_err(|error| StudioError::Message(error.to_string()))?;
            form = form.part("image[]", part);
        }
    }
    for data_url in reference_data_urls {
        let (bytes, mime) = decode_data_url(data_url)?;
        let part = multipart::Part::bytes(bytes)
            .file_name("reference.png")
            .mime_str(&mime)
            .map_err(|error| StudioError::Message(error.to_string()))?;
        form = form.part("image[]", part);
    }
    if let Some(mask_data_url) = input.mask_data_url.as_deref() {
        let (bytes, mime) = decode_data_url(mask_data_url)?;
        let part = multipart::Part::bytes(bytes)
            .file_name("mask.png")
            .mime_str(&mime)
            .map_err(|error| StudioError::Message(error.to_string()))?;
        form = form.part("mask", part);
    }
    let response = state
        .client
        .post(format!("{}/images/edits", settings.base_url))
        .timeout(IMAGE_REQUEST_TIMEOUT)
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
        input.prompt.clone(),
        Some(original.id),
        "edited",
        input.source_task_id.clone(),
        input.source_document_id.clone(),
        input.branch_label.clone(),
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
    let asset = history
        .iter()
        .find(|asset| asset.id == asset_id)
        .ok_or_else(|| StudioError::Message("找不到图片".into()))?;
    Ok(format!(
        "data:{};base64,{}",
        asset.mime_type,
        BASE64.encode(fs::read(&asset.file_path)?)
    ))
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
async fn update_asset_metadata(
    asset_id: String,
    branch_label: Option<String>,
    hidden: Option<bool>,
    state: State<'_, AppState>,
) -> Result<AssetRecord> {
    let mut history = state.history.lock().await;
    let asset = history
        .iter_mut()
        .find(|asset| asset.id == asset_id)
        .ok_or_else(|| StudioError::Message("找不到图片".into()))?;
    if let Some(label) = branch_label {
        let normalized = label.trim();
        if normalized.is_empty() || normalized.chars().count() > 80 {
            return Err(StudioError::Message("版本名称格式不正确".into()));
        }
        if let Some(lineage) = asset.lineage.as_mut() {
            lineage.branch_label = Some(normalized.to_string());
        }
    }
    if let Some(hidden) = hidden {
        asset.hidden_at = hidden.then(|| Utc::now().to_rfc3339());
    }
    let updated = asset.clone();
    atomic_json(&history_path(&state), &*history)?;
    Ok(updated)
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

fn diagnostic_log_filename(value: &str) -> &str {
    Path::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| name.len() <= 160 && name.ends_with(".json"))
        .unwrap_or("image2-diagnostic-log.json")
}

#[tauri::command]
async fn export_diagnostic_log(json: String, suggested_name: String) -> Result<bool> {
    if json.len() > 16 * 1024 * 1024 {
        return Err(StudioError::Message("诊断日志内容过大".into()));
    }
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|_| StudioError::Message("诊断日志格式不正确".into()))?;
    let selected = rfd::AsyncFileDialog::new()
        .add_filter("JSON", &["json"])
        .set_file_name(diagnostic_log_filename(&suggested_name))
        .save_file()
        .await;
    if let Some(target) = selected {
        fs::write(target.path(), json)?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
async fn save_annotation(
    document_id: String,
    source_asset_id: String,
    json: String,
    state: State<'_, AppState>,
) -> Result<()> {
    save_annotation_file(&state, &document_id, &source_asset_id, &json)
}

#[tauri::command]
async fn load_annotation(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<Option<AnnotationDocument>> {
    let path = annotation_path(&state, &document_id)?;
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(load_annotation_file(&path, &document_id)?))
}

#[tauri::command]
async fn list_annotations(
    source_asset_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AnnotationDocument>> {
    list_annotation_files(&state, &source_asset_id)
}

#[tauri::command]
async fn save_annotation_overlay(
    document_id: String,
    data_url: String,
    state: State<'_, AppState>,
) -> Result<String> {
    save_annotation_overlay_file(&state, &document_id, &data_url)
}

#[tauri::command]
async fn read_annotation_overlay_data_url(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<String> {
    let path = find_overlay_path(&state, &document_id)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    let mime = match extension {
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    };
    Ok(format!(
        "data:{mime};base64,{}",
        BASE64.encode(fs::read(path)?)
    ))
}

#[tauri::command]
async fn delete_annotation(document_id: String, state: State<'_, AppState>) -> Result<()> {
    delete_annotation_files(&state, &document_id)
}

async fn cache_prompt_thumbnail_file(remote_path: &str, state: &AppState) -> Result<String> {
    let thumbnail_dir = state.data_dir.join("prompt-thumbnails");
    fs::create_dir_all(&thumbnail_dir)?;
    let relative = remote_path
        .strip_prefix("/prompt-catalog/")
        .ok_or_else(|| StudioError::Message("缩略图路径不在目录白名单中".into()))?;
    let url = format!("{CATALOG_BASE_URL}{relative}");
    validate_catalog_url(&url)?;
    let file_name = Path::new(relative)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| StudioError::Message("缩略图文件名不正确".into()))?;
    let destination = thumbnail_dir.join(file_name);
    if !destination.exists() {
        let bytes = state
            .client
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(StudioError::Message("缩略图文件过大".into()));
        }
        fs::write(&destination, bytes)?;
    }
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
async fn cache_prompt_thumbnail(remote_path: String, state: State<'_, AppState>) -> Result<String> {
    cache_prompt_thumbnail_file(&remote_path, &state).await
}

#[tauri::command]
async fn download_prompt_catalog(
    eager_thumbnails: bool,
    state: State<'_, AppState>,
) -> Result<PromptCatalogDownload> {
    validate_catalog_url(CATALOG_MANIFEST_URL)?;
    let manifest_bytes = state
        .client
        .get(CATALOG_MANIFEST_URL)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)?;
    if manifest
        .get("schemaVersion")
        .and_then(|value| value.as_u64())
        != Some(1)
    {
        return Err(StudioError::Message("灵感目录版本不受支持".into()));
    }
    let expected_manifest_checksum = manifest
        .get("checksum")
        .and_then(|value| value.as_str())
        .ok_or_else(|| StudioError::Message("灵感目录校验值缺失".into()))?;
    let mut manifest_core = manifest.clone();
    manifest_core
        .as_object_mut()
        .expect("manifest schema checked above")
        .remove("checksum");
    if sha256_hex(serde_json::to_string(&manifest_core)?.as_bytes()) != expected_manifest_checksum {
        return Err(StudioError::Message(
            "灵感目录校验失败，已保留旧版本".into(),
        ));
    }
    let shards = manifest
        .get("shards")
        .and_then(|value| value.as_array())
        .ok_or_else(|| StudioError::Message("灵感目录缺少数据分片".into()))?;
    if shards.is_empty() || shards.len() > 16 {
        return Err(StudioError::Message("灵感目录分片数量不正确".into()));
    }

    let mut items = Vec::new();
    for shard in shards {
        let url = shard
            .get("url")
            .and_then(|value| value.as_str())
            .ok_or_else(|| StudioError::Message("灵感目录分片地址缺失".into()))?;
        validate_catalog_url(url)?;
        let expected = shard
            .get("checksum")
            .and_then(|value| value.as_str())
            .ok_or_else(|| StudioError::Message("灵感目录分片校验值缺失".into()))?;
        let bytes = state
            .client
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?;
        if sha256_hex(&bytes) != expected {
            return Err(StudioError::Message(
                "灵感目录分片校验失败，已保留旧版本".into(),
            ));
        }
        let payload: serde_json::Value = serde_json::from_slice(&bytes)?;
        let shard_items = payload
            .get("items")
            .and_then(|value| value.as_array())
            .ok_or_else(|| StudioError::Message("灵感目录分片内容不正确".into()))?;
        items.extend(shard_items.iter().cloned());
    }

    let mut thumbnail_paths = HashMap::new();
    if eager_thumbnails {
        for item in &items {
            let Some(id) = item.get("id").and_then(|value| value.as_str()) else {
                continue;
            };
            let Some(remote_path) = item
                .get("cachedThumbnailPath")
                .and_then(|value| value.as_str())
            else {
                continue;
            };
            thumbnail_paths.insert(
                id.to_string(),
                cache_prompt_thumbnail_file(remote_path, &state).await?,
            );
        }
    }

    Ok(PromptCatalogDownload {
        manifest,
        items,
        thumbnail_paths,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(data_dir.join("assets"))?;
            fs::create_dir_all(data_dir.join("annotations"))?;
            fs::create_dir_all(data_dir.join("annotation-overlays"))?;
            fs::create_dir_all(data_dir.join("prompt-thumbnails"))?;
            let history: Vec<AssetRecord> = if data_dir.join("history.json").exists() {
                serde_json::from_slice(&fs::read(data_dir.join("history.json"))?)
                    .unwrap_or_default()
            } else {
                Vec::new()
            };
            app.manage(AppState {
                client: Client::builder()
                    .timeout(DEFAULT_REQUEST_TIMEOUT)
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
            import_asset,
            edit_image,
            list_assets,
            read_asset_data_url,
            delete_asset,
            update_asset_metadata,
            export_asset,
            export_diagnostic_log,
            save_annotation,
            load_annotation,
            list_annotations,
            save_annotation_overlay,
            read_annotation_overlay_data_url,
            delete_annotation,
            download_prompt_catalog,
            cache_prompt_thumbnail
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
    fn redacts_query_and_fragment_from_network_error_urls() {
        let url = Url::parse("https://example.com/image.png?signature=secret#fragment").unwrap();
        assert_eq!(redacted_url(&url), "https://example.com/image.png");
    }

    #[test]
    fn restricts_diagnostic_log_suggested_filename() {
        assert_eq!(diagnostic_log_filename("image2-log-123.json"), "image2-log-123.json");
        assert_eq!(diagnostic_log_filename("../../private.txt"), "image2-diagnostic-log.json");
        assert_eq!(diagnostic_log_filename("../../nested.json"), "nested.json");
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
        assert_eq!(
            agent_endpoint("chat_completions").unwrap(),
            "chat/completions"
        );
        assert!(agent_endpoint("images/generations").is_err());
        assert!(agent_endpoint("https://example.com").is_err());
    }

    #[test]
    fn restricts_prompt_catalog_downloads_to_repository_path() {
        assert!(validate_catalog_url(CATALOG_MANIFEST_URL).is_ok());
        assert!(validate_catalog_url("https://raw.githubusercontent.com/weilaiqishi/image2-web/main/public/prompt-catalog/catalog-0001.json").is_ok());
        assert!(validate_catalog_url(
            "https://raw.githubusercontent.com/other/repo/main/catalog.json"
        )
        .is_err());
        assert!(validate_catalog_url("https://example.com/catalog-manifest.json").is_err());
        assert!(validate_catalog_url("http://raw.githubusercontent.com/weilaiqishi/image2-web/main/public/prompt-catalog/catalog.json").is_err());
    }

    #[test]
    fn bundled_prompt_manifest_matches_downloader_checksum_rules() {
        let mut manifest: serde_json::Value = serde_json::from_str(include_str!(
            "../../public/prompt-catalog/catalog-manifest.json"
        ))
        .unwrap();
        let expected = manifest
            .get("checksum")
            .and_then(|value| value.as_str())
            .unwrap()
            .to_string();
        manifest.as_object_mut().unwrap().remove("checksum");
        assert_eq!(
            sha256_hex(serde_json::to_string(&manifest).unwrap().as_bytes()),
            expected
        );
    }

    #[test]
    fn rejects_annotation_path_traversal() {
        assert!(validate_local_id("document-01", "标注文档 ID").is_ok());
        assert!(validate_local_id("../settings", "标注文档 ID").is_err());
        assert!(validate_local_id("folder/document", "标注文档 ID").is_err());
        assert!(validate_local_id("", "标注文档 ID").is_err());
    }

    #[test]
    fn annotation_files_are_atomic_recoverable_and_isolated_from_source_assets() {
        let data_dir =
            std::env::temp_dir().join(format!("image2-annotation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(data_dir.join("annotations")).unwrap();
        fs::create_dir_all(data_dir.join("annotation-overlays")).unwrap();
        fs::create_dir_all(data_dir.join("assets")).unwrap();
        let source_path = data_dir.join("assets/source-asset.png");
        fs::write(&source_path, b"source").unwrap();
        let state = AppState {
            client: Client::new(),
            data_dir: data_dir.clone(),
            history: Arc::new(Mutex::new(Vec::new())),
        };

        save_annotation_file(&state, "document-01", "source-asset", r#"{"objects":[]}"#).unwrap();
        assert!(!data_dir.join("annotations/document-01.tmp").exists());
        let loaded = load_annotation_file(
            &data_dir.join("annotations/document-01.json"),
            "document-01",
        )
        .unwrap();
        assert_eq!(loaded.source_asset_id, "source-asset");

        fs::write(data_dir.join("annotations/damaged.json"), b"not-json").unwrap();
        let listed = list_annotation_files(&state, "source-asset").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].document_id, "document-01");

        save_annotation_overlay_file(&state, "document-01", "data:image/png;base64,AA==").unwrap();
        assert_eq!(
            fs::read(find_overlay_path(&state, "document-01").unwrap()).unwrap(),
            vec![0]
        );

        delete_annotation_files(&state, "document-01").unwrap();
        assert!(!data_dir.join("annotations/document-01.json").exists());
        assert!(source_path.exists());
        fs::remove_dir_all(data_dir).unwrap();
    }
}
