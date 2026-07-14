# Image2 Studio

Image2 Studio is a local-first Windows/macOS client for GPT Image generation and Cowart-inspired visual revision. It uses a fixed Fabric.js annotation canvas rather than an infinite whiteboard: the original image stays locked while circles, arrows, and text communicate what should change.

## Stack

- Tauri 2 with a Rust backend
- React 19, TypeScript, Vite
- Fabric.js 7 annotation editor
- `reqwest` for OpenAI-compatible image requests
- macOS Keychain / Windows Credential Manager for the API key

The renderer cannot read the stored API key or make arbitrary network requests. Image requests run in Rust, so custom OpenAI-compatible endpoints are not affected by browser CORS.

## Development

Prerequisites: Node.js 20+, Rust stable, and the native Tauri prerequisites for your operating system.

```bash
npm install
npm run tauri:dev
```

Web-only UI preview:

```bash
npm run dev
```

Open `http://127.0.0.1:1420/?demo=1` to inspect the included mooncake generation and revision demo without calling an API.

## Verification

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Run the paid real-API MVP test only with an explicitly supplied test key:

```bash
OPENAI_BASE_URL=https://api.openai.com/v1 \
OPENAI_API_KEY=... \
OPENAI_IMAGE_MODEL=gpt-image-2 \
npm run test:mvp
```

The script generates a mooncake product image, adds a red arrow/circle annotation requesting a store address at the bottom, submits an image edit, and verifies that the result is a valid changed image. Outputs are written to the ignored `artifacts/mvp-test/` directory.

## Packaging

```bash
npm run tauri:build
```

Tauri produces the platform-native bundles on the current operating system. The CI workflow builds macOS and Windows separately. Release signing and notarization are intentionally not configured for this MVP.
