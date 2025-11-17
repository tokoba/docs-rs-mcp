# docs-rs-mcp アーキテクチャ設計書

## 1. アーキテクチャ概要

### 1.1 システムアーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP クライアント                         │
│         (VS Code / Cursor / Claude Desktop)                 │
└────────────────────┬────────────────────────────────────────┘
                     │ stdio (標準入出力)
                     │ MCP プロトコル
┌────────────────────▼────────────────────────────────────────┐
│                 DocsRsMcpServer                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  @modelcontextprotocol/sdk                           │  │
│  │  - Server                                            │  │
│  │  - StdioServerTransport                              │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ツールハンドラ層                                     │  │
│  │  - setupToolHandlers()                               │  │
│  │  - ListToolsRequestSchema                            │  │
│  │  - CallToolRequestSchema                             │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ビジネスロジック層                                   │  │
│  │  - searchCrates()                                    │  │
│  │  - getReadMe()                                       │  │
│  │  │  - getItem()                                       │  │
│  │  - searchInCrate()                                   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────┘
                     │ axios (HTTP)
         ┌───────────┴───────────┐
         │                       │
┌────────▼─────────┐   ┌─────────▼──────────┐
│   crates.io API  │   │     docs.rs        │
│   /api/v1/crates │   │   HTML ページ群    │
└──────────────────┘   └────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  cheerio (解析)   │
                    │  turndown (変換)  │
                    └───────────────────┘
```

### 1.2 レイヤー構成

#### 1.2.1 トランスポート層
- **役割**: MCP クライアントとの通信
- **実装**: `StdioServerTransport`
- **プロトコル**: 標準入出力 (stdio) を介した JSON-RPC

#### 1.2.2 プロトコル層
- **役割**: MCP プロトコルの実装
- **実装**: `@modelcontextprotocol/sdk` の `Server` クラス
- **機能**: リクエストスキーマのバリデーション、ルーティング

#### 1.2.3 ハンドラ層
- **役割**: ツールリスト提供とツール呼び出しの処理
- **実装**: `setupToolHandlers()`
- **スキーマ**: `ListToolsRequestSchema`, `CallToolRequestSchema`

#### 1.2.4 ビジネスロジック層
- **役割**: 各ツールの実装ロジック
- **実装**: `searchCrates()`, `getReadMe()`, `getItem()`, `searchInCrate()`

#### 1.2.5 外部 API 層
- **役割**: 外部サービスとの通信
- **実装**: axios によるHTTPリクエスト
- **対象**: crates.io API, docs.rs

#### 1.2.6 データ変換層
- **役割**: HTML → Markdown 変換
- **実装**: cheerio (HTML解析), turndown (Markdown変換)

## 2. クラス設計

### 2.1 DocsRsMcpServer クラス

#### 2.1.1 クラス定義
```typescript
class DocsRsMcpServer {
    private server: Server;

    constructor();
    private setupToolHandlers(): void;
    private async searchCrates(args: any): Promise<object>;
    private async getReadMe(args: any): Promise<object>;
    private async getItem(args: any): Promise<object>;
    private async searchInCrate(args: any): Promise<object>;
    async run(): Promise<void>;
}
```

#### 2.1.2 プライベートプロパティ

**`server: Server`**
- **型**: `@modelcontextprotocol/sdk` の `Server` インスタンス
- **役割**: MCP サーバーのコアインスタンス
- **初期化**: コンストラクタで生成
- **設定**:
  ```typescript
  {
      name: "docs-rs",
      version: "1.0.1"
  }
  ```
- **機能**: `tools` 機能を提供

### 2.2 コンストラクタ

#### 2.2.1 実装
```typescript
constructor() {
    this.server = new Server(
        {
            name: "docs-rs",
            version: "1.0.1",
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    this.setupToolHandlers();
}
```

#### 2.2.2 処理フロー
1. `Server` インスタンスを生成
2. サーバー名とバージョンを設定
3. ツール機能を有効化
4. ツールハンドラをセットアップ

## 3. メソッド詳細

### 3.1 setupToolHandlers()

#### 3.1.1 役割
MCP プロトコルのリクエストハンドラを登録する。

#### 3.1.2 実装内容

**ListToolsRequestSchema ハンドラ**
- **役割**: 利用可能なツールのリストを返す
- **戻り値**: 4つのツール定義 (inputSchema を含む)
- **ツール一覧**:
  1. `docs_rs_search_crates`
  2. `docs_rs_readme`
  3. `docs_rs_get_item`
  4. `docs_rs_search_in_crate`

**CallToolRequestSchema ハンドラ**
- **役割**: ツールの実行を処理
- **処理フロー**:
  ```typescript
  switch (request.params.name) {
      case "docs_rs_search_crates":
          return await this.searchCrates(request.params.arguments);
      case "docs_rs_readme":
          return await this.getReadMe(request.params.arguments);
      case "docs_rs_get_item":
          return await this.getItem(request.params.arguments);
      case "docs_rs_search_in_crate":
          return await this.searchInCrate(request.params.arguments);
      default:
          throw new McpError(ErrorCode.MethodNotFound, ...);
  }
  ```

#### 3.1.3 エラーハンドリング
```typescript
try {
    // ツール実行
} catch (error) {
    throw new McpError(
        ErrorCode.InternalError,
        `Error executing tool ${request.params.name}: ${error}`
    );
}
```

### 3.2 searchCrates()

#### 3.2.1 シグネチャ
```typescript
private async searchCrates(args: any): Promise<object>
```

#### 3.2.2 引数
```typescript
{
    query: string,          // 必須
    per_page?: number,      // デフォルト: 10
    sort?: string          // デフォルト: "relevance"
}
```

#### 3.2.3 処理フロー
1. 引数の分割代入とデフォルト値設定
2. crates.io API へのリクエスト
3. レスポンスのマッピング
4. Markdown 形式への整形
5. MCP レスポンスオブジェクトの返却

#### 3.2.4 データ変換
```typescript
const crates = response.data.crates.map((crate: any) => ({
    name: crate.name,
    description: crate.description || "No description available",
    downloads: crate.downloads,
    version: crate.newest_version,
    documentation: crate.documentation,
}));
```

#### 3.2.5 レスポンス構造
```typescript
{
    content: [
        {
            type: "text",
            text: "# Crate Search Results...\n\n..."
        }
    ]
}
```

#### 3.2.6 エラー処理
```typescript
catch (error) {
    throw new Error(`Failed to search crates: ${error}`);
}
```

### 3.3 getReadMe()

#### 3.3.1 シグネチャ
```typescript
private async getReadMe(args: any): Promise<object>
```

#### 3.3.2 引数
```typescript
{
    crate_name: string,    // 必須
    version?: string       // デフォルト: "latest"
}
```

#### 3.3.3 処理フロー
1. URL の構築
2. HTML の取得
3. cheerio による DOM 読み込み
4. ドキュメント部分の抽出
5. HTML → Markdown 変換
6. レスポンスの返却

#### 3.3.4 URL 構築
```typescript
const url = `https://docs.rs/${crate_name}/${version}/${crate_name}/index.html`;
```

#### 3.3.5 セレクタ優先順位
1. `.rustdoc .docblock` (最初の要素)
2. `.rustdoc-main .item-decl` (代替、最初の要素)

#### 3.3.6 Markdown 変換
```typescript
const htmlContent = mainContent.html() || "";
const markdownContent = turndownService.turndown(htmlContent);
```

#### 3.3.7 フォールバック処理
コンテンツが見つからない場合:
```typescript
{
    content: [{
        type: "text",
        text: `# ${crate_name} Documentation\n\nNo documentation content found at ${url}`
    }]
}
```

### 3.4 getItem()

#### 3.4.1 シグネチャ
```typescript
private async getItem(args: any): Promise<object>
```

#### 3.4.2 引数
```typescript
{
    crate_name: string,    // 必須
    item_type: string,     // 必須
    item_path: string,     // 必須
    version?: string       // デフォルト: "latest"
}
```

#### 3.4.3 処理フロー
1. `item_path` からアイテム名を抽出
2. `item_type` に応じた URL 構築
3. HTML の取得と解析
4. ドキュメント部分の抽出
5. Markdown 変換
6. レスポンス返却

#### 3.4.4 アイテム名の抽出
```typescript
const item_name = item_path.split("::").pop();
```

例: `"wasmtime::component::Component"` → `"Component"`

#### 3.4.5 URL 構築ロジック

**モジュールの場合:**
```typescript
if (item_type === "module") {
    url = `https://docs.rs/${crate_name}/${version}/${item_path.replaceAll("::", "/")}/index.html`;
}
```

**その他のアイテムの場合:**
```typescript
const pathParts = item_path.split("::");
const modulePath = pathParts.slice(0, -1).join("/");
url = `https://docs.rs/${crate_name}/${version}/${modulePath}/${item_type}.${item_name}.html`;
```

#### 3.4.6 セレクタ優先順位
1. `#main-content`
2. `.rustdoc .item-decl` + `.rustdoc .docblock`
3. `.rustdoc-main .item-decl`

#### 3.4.7 コンテンツ結合
```typescript
if (itemDecl.length > 0) {
    contentHtml += itemDecl.html() || "";
}
if (mainContent.length > 0) {
    contentHtml += mainContent.html() || "";
}
```

### 3.5 searchInCrate()

#### 3.5.1 シグネチャ
```typescript
private async searchInCrate(args: any): Promise<object>
```

#### 3.5.2 引数
```typescript
{
    crate_name: string,    // 必須
    query: string,         // 必須
    version?: string,      // デフォルト: "latest"
    item_type?: string     // オプション
}
```

#### 3.5.3 処理フロー
1. all.html ページの取得
2. すべてのリンクを走査
3. アイテムタイプの判定
4. フィルタリング
5. 重複除去
6. Markdown 形式への整形

#### 3.5.4 URL 構築
```typescript
const url = `https://docs.rs/${crate_name}/${version}/${crate_name}/all.html`;
```

#### 3.5.5 リンク走査
```typescript
$("#main-content a").each((_, element) => {
    const $link = $(element);
    const itemName = $link.text().trim();
    const itemLink = $link.attr("href") || "";

    // タイプ判定とフィルタリング
});
```

#### 3.5.6 タイプ判定ロジック
```typescript
let type = "unknown";
if (itemLink.includes("struct.")) type = "struct";
else if (itemLink.includes("trait.")) type = "trait";
else if (itemLink.includes("fn.")) type = "function";
else if (itemLink.includes("enum.")) type = "enum";
else if (itemLink.includes("type.")) type = "type";
else if (itemLink.includes("const.")) type = "constant";
else if (itemLink.includes("static.")) type = "static";
else if (itemLink.includes("macro.")) type = "macro";
```

#### 3.5.7 フィルタリング条件
```typescript
const matchesQuery = !query || query == "" ||
    itemName.toLowerCase().includes(query.toLowerCase());
const matchesType = !item_type || item_type == "" ||
    type === item_type ||
    itemName.toLowerCase().includes(item_type.toLowerCase());

if (matchesQuery && matchesType && type !== "unknown") {
    items.push({ name: itemName, type, link });
}
```

#### 3.5.8 重複除去アルゴリズム
```typescript
const uniqueItems = items.filter((item, index, self) =>
    index === self.findIndex(i =>
        i.name === item.name && i.type === item.type
    )
);
```

#### 3.5.9 URL 正規化
```typescript
link: itemLink.startsWith("http")
    ? itemLink
    : `https://docs.rs/${crate_name}/${version}/${crate_name}/${itemLink}`
```

### 3.6 run()

#### 3.6.1 シグネチャ
```typescript
async run(): Promise<void>
```

#### 3.6.2 実装
```typescript
async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("docs.rs MCP server running on stdio");
}
```

#### 3.6.3 処理内容
1. `StdioServerTransport` のインスタンス生成
2. サーバーをトランスポートに接続
3. stderr に起動メッセージを出力

#### 3.6.4 注意点
- `console.error` を使用 (stdout は MCP プロトコル通信用)
- `await` による非同期接続処理

## 4. インターフェース定義

### 4.1 CrateSearchResult

```typescript
interface CrateSearchResult {
    name: string;
    description: string;
    downloads: number;
    version: string;
    documentation: string | null;
}
```

#### 4.1.1 プロパティ詳細

| プロパティ | 型 | null許可 | 説明 |
|-----------|-----|---------|------|
| `name` | string | ✗ | クレート名 |
| `description` | string | ✗ | クレートの説明 |
| `downloads` | number | ✗ | 総ダウンロード数 |
| `version` | string | ✗ | 最新バージョン番号 |
| `documentation` | string \| null | ✓ | ドキュメントURL |

## 5. グローバルオブジェクト

### 5.1 turndownService

```typescript
const turndownService = new TurndownService({
    codeBlockStyle: "fenced",
});
```

#### 5.1.1 役割
HTML を Markdown に変換するサービス

#### 5.1.2 設定
- **codeBlockStyle**: `"fenced"` - コードブロックを ``` 形式で出力

#### 5.1.3 使用箇所
- `getReadMe()`: README コンテンツの変換
- `getItem()`: アイテムドキュメントの変換

## 6. エントリーポイント

### 6.1 モジュールレベルの処理

```typescript
const server = new DocsRsMcpServer();
server.run().catch(console.error);
```

#### 6.1.1 処理フロー
1. `DocsRsMcpServer` インスタンスの生成
2. `run()` メソッドの実行
3. エラー時は `console.error` で出力

## 7. 依存関係グラフ

```
DocsRsMcpServer
├── @modelcontextprotocol/sdk
│   ├── Server
│   ├── StdioServerTransport
│   ├── ListToolsRequestSchema
│   ├── CallToolRequestSchema
│   ├── ErrorCode
│   └── McpError
├── axios
│   └── get()
├── cheerio
│   └── load()
└── turndown
    └── TurndownService
```

## 8. 状態管理

### 8.1 ステートレス設計
`DocsRsMcpServer` はステートレスな設計:
- 各メソッドは独立して実行可能
- リクエスト間で状態を保持しない
- すべての必要な情報は引数で受け取る

### 8.2 唯一の状態
- `server` プロパティ: 初期化時に設定され、以降変更されない

## 9. エラーハンドリング戦略

### 9.1 階層的エラー処理

```
┌─────────────────────────────────────┐
│  setupToolHandlers() レベル         │
│  McpError(InternalError)            │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  各ツールメソッド レベル             │
│  throw new Error("Failed to...")   │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  外部 API レベル                     │
│  axios / cheerio エラー             │
└─────────────────────────────────────┘
```

### 9.2 エラータイプ

**MCP プロトコルエラー:**
- `ErrorCode.MethodNotFound`: 未知のツール
- `ErrorCode.InternalError`: 実行時エラー

**ビジネスロジックエラー:**
- `Failed to search crates: {error}`
- `Failed to get README for {crate_name}: {error}`
- `Failed to get item documentation for {item_path}: {error}`
- `Failed to search items in {crate_name}: {error}`

## 10. 非同期処理パターン

### 10.1 async/await の使用
すべての外部API呼び出しメソッドで `async/await` を使用:
- `searchCrates()`
- `getReadMe()`
- `getItem()`
- `searchInCrate()`
- `run()`

### 10.2 並列処理の可能性
現在の実装では順次処理だが、将来的には:
- 複数のドキュメント取得を並列化
- `Promise.all()` による最適化
が検討可能

## 11. 拡張性の考慮

### 11.1 新しいツールの追加手順
1. `setupToolHandlers()` の `ListToolsRequestSchema` にツール定義を追加
2. `CallToolRequestSchema` の `switch` に case を追加
3. 新しいプライベートメソッドを実装

### 11.2 将来的な拡張可能性
- crates.io の追加 API サポート
- キャッシング機構の追加
- レート制限の実装
- zod によるバリデーション強化
