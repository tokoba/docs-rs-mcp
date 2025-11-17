# docs-rs-mcp 設計仕様書

## 1. プロジェクト概要

### 1.1 プロジェクト名
`@nuskey8/docs-rs-mcp`

### 1.2 バージョン
1.0.1

### 1.3 目的
Rust クレートのドキュメントサイト [docs.rs](https://docs.rs) および [crates.io](https://crates.io) と連携し、AI エージェントが必要なクレートを検索し、最新のドキュメントを取得できるようにする MCP (Model Context Protocol) サーバーを提供する。

### 1.4 主要機能
- Rust クレートのキーワード検索
- クレートの README/概要の取得
- 特定のアイテム（モジュール、構造体、トレイト、列挙型、関数など）のドキュメント取得
- クレート内のアイテムの検索

### 1.5 ライセンス
MIT License

## 2. システム要件

### 2.1 実行環境
- **Node.js**: 18 以上
- **MCP クライアント**: VS Code、Cursor、Claude Desktop など

### 2.2 依存パッケージ

#### 2.2.1 実行時依存関係
| パッケージ | バージョン | 用途 |
|-----------|-----------|------|
| `@modelcontextprotocol/sdk` | ^1.13.2 | MCP プロトコルの実装 |
| `axios` | ^1.11.0 | HTTP リクエスト処理 |
| `cheerio` | ^1.1.2 | HTML パース・DOM 操作 |
| `turndown` | ^7.2.0 | HTML から Markdown への変換 |
| `zod` | ^3.25.67 | スキーマ検証（将来の拡張用） |
| `@types/axios` | ^0.9.36 | axios の型定義 |
| `@types/cheerio` | ^0.22.35 | cheerio の型定義 |
| `@types/turndown` | ^5.0.5 | turndown の型定義 |

#### 2.2.2 開発時依存関係
| パッケージ | バージョン | 用途 |
|-----------|-----------|------|
| `@types/node` | ^24.0.7 | Node.js の型定義 |
| `typescript` | ^5.8.3 | TypeScript コンパイラ |
| `vitest` | ^3.2.4 | テストフレームワーク |

### 2.3 TypeScript 設定

```json
{
  "target": "ES2022",
  "module": "Node16",
  "moduleResolution": "Node16",
  "outDir": "./build",
  "rootDir": "./src",
  "strict": true,
  "esModuleInterop": true,
  "skipLibCheck": true,
  "forceConsistentCasingInFileNames": true
}
```

## 3. ツール仕様

### 3.1 docs_rs_search_crates

#### 3.1.1 概要
crates.io の API を使用して、キーワードから Rust クレートを検索する。

#### 3.1.2 入力パラメーター

| パラメーター | 型 | 必須 | デフォルト値 | 説明 |
|------------|------|------|-------------|------|
| `query` | string | ✓ | - | 検索キーワード（英語推奨） |
| `per_page` | number | ✗ | 10 | 1ページあたりの結果数（最大100） |
| `sort` | string | ✗ | "relevance" | ソート順: "relevance", "downloads", "recent-downloads", "recent-updates", "new" |

#### 3.1.3 出力形式
Markdown形式のテキスト

```markdown
# Crate Search Results for "{query}"

## {crate_name} ({version})

**Description:** {description}

**Downloads:** {downloads}

**Documentation:** {documentation_url}

---
```

#### 3.1.4 API エンドポイント
```
GET https://crates.io/api/v1/crates
```

#### 3.1.5 パラメーター制約
- `per_page`: 最大値100に制限（`Math.min(per_page, 100)`）
- `sort`: 指定された5つの値のいずれか

#### 3.1.6 エラー処理
- API リクエスト失敗時: `Failed to search crates: {error}`

### 3.2 docs_rs_readme

#### 3.2.1 概要
指定されたクレートの README/概要ページのドキュメントを取得する。

#### 3.2.2 入力パラメーター

| パラメーター | 型 | 必須 | デフォルト値 | 説明 |
|------------|------|------|-------------|------|
| `crate_name` | string | ✓ | - | クレート名 |
| `version` | string | ✗ | "latest" | バージョン番号（例: "1.0.0"） |

#### 3.2.3 URL パターン
```
https://docs.rs/{crate_name}/{version}/{crate_name}/index.html
```

#### 3.2.4 HTML セレクタ
- **メインコンテンツ**: `.rustdoc .docblock` (最初の要素)
- **代替コンテンツ**: `.rustdoc-main .item-decl` (最初の要素、メインが見つからない場合)

#### 3.2.5 出力形式
Markdown形式のテキスト

```markdown
# {crate_name} Documentation

{markdown_content}
```

#### 3.2.6 エラー処理
- ドキュメント未発見: `No documentation content found at {url}`
- 取得失敗: `Failed to get README for {crate_name}: {error}`

### 3.3 docs_rs_get_item

#### 3.3.1 概要
クレート内の特定のアイテム（モジュール、構造体、トレイト、列挙型、関数など）のドキュメントを取得する。

#### 3.3.2 入力パラメーター

| パラメーター | 型 | 必須 | デフォルト値 | 説明 |
|------------|------|------|-------------|------|
| `crate_name` | string | ✓ | - | クレート名 |
| `item_type` | string | ✓ | - | アイテムの種類: "module", "struct", "trait", "enum", "type", "fn" など |
| `item_path` | string | ✓ | - | アイテムのフルパス（例: "wasmtime::component::Component"） |
| `version` | string | ✗ | "latest" | バージョン番号 |

#### 3.3.3 URL 構築ロジック

**モジュールの場合:**
```
https://docs.rs/{crate_name}/{version}/{item_path_with_slashes}/index.html
```
例: `wasmtime::component` → `https://docs.rs/wasmtime/latest/wasmtime/component/index.html`

**その他のアイテムの場合:**
```
https://docs.rs/{crate_name}/{version}/{module_path}/{item_type}.{item_name}.html
```
例: `wasmtime::component::Component` (struct) →
`https://docs.rs/wasmtime/latest/wasmtime/component/struct.Component.html`

#### 3.3.4 パスの解析
```typescript
const item_name = item_path.split("::").pop();
const modulePath = pathParts.slice(0, -1).join("/");
```

#### 3.3.5 HTML セレクタ
1. **優先**: `#main-content`
2. **代替1**: `.rustdoc .item-decl` + `.rustdoc .docblock`
3. **代替2**: `.rustdoc-main .item-decl`

#### 3.3.6 出力形式
```markdown
# {item_path} ({item_type})

**Documentation URL:** {url}

{markdown_content}
```

#### 3.3.7 エラー処理
- ドキュメント未発見: `No documentation content found at {url}`
- 取得失敗: `Failed to get item documentation for {item_path}: {error}`

### 3.4 docs_rs_search_in_crate

#### 3.4.1 概要
クレート内の all.html ページから、トレイト、構造体、メソッドなどを検索する。

#### 3.4.2 入力パラメーター

| パラメーター | 型 | 必須 | デフォルト値 | 説明 |
|------------|------|------|-------------|------|
| `crate_name` | string | ✓ | - | 検索対象のクレート名 |
| `query` | string | ✓ | - | 検索キーワード（トレイト名、構造体名、関数名など） |
| `version` | string | ✗ | "latest" | バージョン番号 |
| `item_type` | string | ✗ | - | アイテムタイプでフィルタ: "struct", "trait", "fn", "enum", "union", "macro", "constant" |

#### 3.4.3 URL パターン
```
https://docs.rs/{crate_name}/{version}/{crate_name}/all.html
```

#### 3.4.4 アイテムタイプの判定ロジック

リンクの URL パターンから判定:
- `struct.` を含む → "struct"
- `trait.` を含む → "trait"
- `fn.` を含む → "function"
- `enum.` を含む → "enum"
- `type.` を含む → "type"
- `const.` を含む → "constant"
- `static.` を含む → "static"
- `macro.` を含む → "macro"
- それ以外 → "unknown" (除外)

#### 3.4.5 フィルタリングロジック
```typescript
const matchesQuery = !query || query == "" || itemName.toLowerCase().includes(query.toLowerCase());
const matchesType = !item_type || item_type == "" || type === item_type || itemName.toLowerCase().includes(item_type.toLowerCase());

if (matchesQuery && matchesType && type !== "unknown") {
    // アイテムを結果に追加
}
```

#### 3.4.6 重複除去
```typescript
const uniqueItems = items.filter((item, index, self) =>
    index === self.findIndex(i => i.name === item.name && i.type === item.type)
);
```

#### 3.4.7 出力形式
```markdown
# Search Results for "{query}" in {crate_name}

Found {count} items

## {item_name} ({item_type})

**Description:** {item_type}

**Link:** [View Documentation]({link})

---
```

#### 3.4.8 エラー処理
- 検索失敗: `Failed to search items in {crate_name}: {error}`

## 4. MCP サーバー設定

### 4.1 サーバー情報
```typescript
{
    name: "docs-rs",
    version: "1.0.1"
}
```

### 4.2 サーバー機能
```typescript
{
    capabilities: {
        tools: {}
    }
}
```

### 4.3 トランスポート
- **プロトコル**: StdioServerTransport
- **入出力**: 標準入出力 (stdio)

## 5. Markdown 変換設定

### 5.1 Turndown Service 設定
```typescript
{
    codeBlockStyle: "fenced"
}
```

コードブロックをフェンス形式（```）で出力する。

## 6. NPM スクリプト

### 6.1 利用可能なコマンド

| コマンド | 実行内容 | 説明 |
|---------|---------|------|
| `npm run dev` | `tsx watch src/index.ts` | 開発モード（ファイル監視） |
| `npm run build` | `tsc && chmod 755 build/index.js` | TypeScript コンパイル + 実行権限付与 |
| `npm run start` | `tsc && chmod 755 build/index.js && node build/index.js` | ビルド + 実行 |

### 6.2 バイナリエントリポイント
```json
{
    "bin": {
        "docs-rs-mcp": "build/index.js"
    }
}
```

npx 経由で実行可能:
```bash
npx @nuskey8/docs-rs-mcp@latest
```

## 7. クライアント設定例

### 7.1 VS Code (.vscode/mcp.json)
```json
{
    "servers": {
        "docs-rs": {
            "command": "npx",
            "args": [
                "@nuskey8/docs-rs-mcp@latest",
                "-y"
            ]
        }
    }
}
```

### 7.2 Claude Code
```bash
claude mcp add docs-rs -s project -- npx -y @nuskey8/docs-rs-mcp@latest
```

### 7.3 Cursor
```text
Cursor Settings > MCP > Add new MCP Server
Command: npx @nuskey8/docs-rs-mcp
```

## 8. データモデル

### 8.1 CrateSearchResult インターフェース
```typescript
interface CrateSearchResult {
    name: string;           // クレート名
    description: string;    // クレートの説明
    downloads: number;      // ダウンロード数
    version: string;        // 最新バージョン
    documentation: string | null;  // ドキュメントURL
}
```

### 8.2 SearchInCrate アイテム
```typescript
{
    name: string;     // アイテム名
    type: string;     // アイテムタイプ
    link: string;     // ドキュメントURL
}
```

## 9. エラーコード

### 9.1 MCP エラーコード
- `ErrorCode.MethodNotFound`: 未知のツール名が指定された場合
- `ErrorCode.InternalError`: ツール実行中にエラーが発生した場合

### 9.2 カスタムエラーメッセージ
- `Unknown tool: {tool_name}`
- `Error executing tool {tool_name}: {error}`

## 10. セキュリティとバリデーション

### 10.1 入力検証
- `per_page`: 最大値100に制限
- URL構築時のパス処理: `::` を `/` に変換

### 10.2 外部API
- **crates.io API**: `https://crates.io/api/v1/crates`
- **docs.rs**: `https://docs.rs/`

両サイトは信頼できる公式サイトとして扱われる。

## 11. パフォーマンス考慮事項

### 11.1 HTTP リクエスト
- axios を使用した非同期リクエスト
- エラー時のタイムアウト処理は axios のデフォルト設定に依存

### 11.2 HTML パース
- cheerio による軽量なサーバーサイド DOM 操作
- メモリ効率の良い実装

## 12. 制約事項

### 12.1 モジュール検索の制限
`docs_rs_search_in_crate` ではモジュールを取得できない。モジュールを取得する場合は `docs_rs_get_item` を使用する必要がある。

### 12.2 バージョン指定
デフォルトは "latest" だが、特定のバージョンを指定することも可能。

### 12.3 検索の大文字小文字
`docs_rs_search_in_crate` での検索は大文字小文字を区別しない（`toLowerCase()` を使用）。
