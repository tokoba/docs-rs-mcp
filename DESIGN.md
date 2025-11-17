# docs-rs-mcp 詳細設計・実装テクニック

## 1. 実装テクニック概要

本ドキュメントは、`docs-rs-mcp` プロジェクトにおける実装レベルの詳細な設計決定、コーディングパターン、技術的な工夫について説明する。

## 2. TypeScript 型設計

### 2.1 型安全性の戦略

#### 2.1.1 現在の型使用状況
```typescript
private async searchCrates(args: any)
private async getReadMe(args: any)
private async getItem(args: any)
private async searchInCrate(args: any)
```

現在は `any` 型を使用しているが、これは MCP SDK の引数型が動的であるため。

#### 2.1.2 改善案：厳密な型定義
```typescript
// 将来的な改善案
interface SearchCratesArgs {
    query: string;
    per_page?: number;
    sort?: "relevance" | "downloads" | "recent-downloads" | "recent-updates" | "new";
}

interface GetReadMeArgs {
    crate_name: string;
    version?: string;
}

interface GetItemArgs {
    crate_name: string;
    item_type: string;
    item_path: string;
    version?: string;
}

interface SearchInCrateArgs {
    crate_name: string;
    query: string;
    version?: string;
    item_type?: "struct" | "trait" | "fn" | "enum" | "union" | "macro" | "constant";
}
```

### 2.2 インターフェース設計の原則

#### 2.2.1 CrateSearchResult の設計理由
```typescript
interface CrateSearchResult {
    name: string;
    description: string;
    downloads: number;
    version: string;
    documentation: string | null;
}
```

**設計ポイント:**
- `documentation` のみ `null` 許可: crates.io API がドキュメントURLを持たない場合がある
- `description`: API から取得できない場合は "No description available" でフォールバック
- `downloads`: 常に数値で提供される

### 2.3 zod の活用可能性

現在 `zod` は依存関係に含まれているが未使用。将来的な活用例:

```typescript
import { z } from "zod";

const SearchCratesArgsSchema = z.object({
    query: z.string().min(1),
    per_page: z.number().min(1).max(100).optional().default(10),
    sort: z.enum(["relevance", "downloads", "recent-downloads", "recent-updates", "new"])
        .optional()
        .default("relevance"),
});

// 使用例
private async searchCrates(args: any) {
    const validatedArgs = SearchCratesArgsSchema.parse(args);
    // ...
}
```

**メリット:**
- 実行時のバリデーション
- 自動的な型推論
- 詳細なエラーメッセージ

## 3. 文字列処理とURL構築

### 3.1 パス変換テクニック

#### 3.1.1 Rust パス → URL パスの変換
```typescript
// モジュールパスの場合
item_path.replaceAll("::", "/")
```

**例:**
```
"wasmtime::component" → "wasmtime/component"
"std::collections::HashMap" → "std/collections/HashMap"
```

#### 3.1.2 アイテム名の抽出
```typescript
const item_name = item_path.split("::").pop();
```

**処理フロー:**
1. `"::"` で分割: `["wasmtime", "component", "Component"]`
2. `pop()` で最後の要素を取得: `"Component"`

#### 3.1.3 モジュールパスの抽出
```typescript
const pathParts = item_path.split("::");
const modulePath = pathParts.slice(0, -1).join("/");
```

**例:**
```
入力: "wasmtime::component::Component"
pathParts: ["wasmtime", "component", "Component"]
slice(0, -1): ["wasmtime", "component"]
結果: "wasmtime/component"
```

### 3.2 URL 構築パターン

#### 3.2.1 テンプレートリテラルの使用
```typescript
const url = `https://docs.rs/${crate_name}/${version}/${crate_name}/index.html`;
```

**利点:**
- 可読性が高い
- 変数埋め込みが簡潔

#### 3.2.2 条件分岐による URL 構築
```typescript
let url: string;

if (item_type === "module") {
    url = `https://docs.rs/${crate_name}/${version}/${item_path.replaceAll("::", "/")}/index.html`;
} else {
    const pathParts = item_path.split("::");
    const modulePath = pathParts.slice(0, -1).join("/");
    url = `https://docs.rs/${crate_name}/${version}/${modulePath}/${item_type}.${item_name}.html`;
}
```

**設計理由:**
- モジュールとその他のアイテムで URL 構造が異なる
- docs.rs の命名規則に従う必要がある

### 3.3 大文字小文字の処理

#### 3.3.1 不一致検索の実装
```typescript
itemName.toLowerCase().includes(query.toLowerCase())
```

**効果:**
- ユーザー入力の柔軟性向上
- "HashMap" でも "hashmap" でも検索可能

#### 3.3.2 トレードオフ
- **メリット**: UX の向上
- **デメリット**: 完全一致検索ができない
- **対策**: 将来的には `exact_match` オプションの追加を検討

## 4. HTML 解析戦略

### 4.1 cheerio の使用パターン

#### 4.1.1 基本的な読み込み
```typescript
const $ = cheerio.load(response.data);
```

**特徴:**
- jQuery ライクな API
- サーバーサイドで動作
- DOM 操作が高速

#### 4.1.2 セレクタの優先順位設計

**getReadMe() の場合:**
```typescript
const mainContent = $(".rustdoc .docblock").first();

if (mainContent.length === 0) {
    const alternativeContent = $(".rustdoc-main .item-decl").first();
    // ...
}
```

**設計理由:**
- docs.rs のHTML構造が変更される可能性に対応
- 複数のフォールバックで堅牢性を確保

**getItem() の場合:**
```typescript
const mainContentSection = $("#main-content");
let contentHtml = "";

if (mainContentSection.length > 0) {
    contentHtml = mainContentSection.html() || "";
} else {
    const itemDecl = $(".rustdoc .item-decl").first();
    const mainContent = $(".rustdoc .docblock").first();

    if (itemDecl.length > 0) {
        contentHtml += itemDecl.html() || "";
    }

    if (mainContent.length === 0) {
        const alternativeContent = $(".rustdoc-main .item-decl").first();
        if (alternativeContent.length > 0) {
            contentHtml += alternativeContent.html() || "";
        }
    } else {
        contentHtml += mainContent.html() || "";
    }
}
```

**3段階のフォールバック:**
1. `#main-content` を優先
2. `.item-decl` + `.docblock` を連結
3. `.rustdoc-main .item-decl` を代替

#### 4.1.3 length チェックのパターン
```typescript
if (mainContent.length === 0) {
    // 要素が見つからない場合の処理
}
```

**理由:**
- cheerio は要素が見つからない場合、空の配列を返す
- `length === 0` で存在確認

#### 4.1.4 null 安全な HTML 取得
```typescript
const htmlContent = mainContent.html() || "";
```

**設計:**
- `html()` は `null` を返す可能性がある
- `|| ""` で空文字列にフォールバック

### 4.2 属性取得のテクニック

```typescript
const itemLink = $link.attr("href") || "";
```

**安全性:**
- `attr()` は `undefined` を返す可能性
- `|| ""` でデフォルト値を設定

## 5. Markdown 変換の実装

### 5.1 TurndownService の設定

```typescript
const turndownService = new TurndownService({
    codeBlockStyle: "fenced",
});
```

#### 5.1.1 fenced コードブロックの選択理由

**fenced スタイル:**
```markdown
```rust
fn main() {
    println!("Hello");
}
```
```

**indented スタイル:**
```markdown
    fn main() {
        println!("Hello");
    }
```

**選択理由:**
- シンタックスハイライトの言語指定が可能
- LLM による解析が容易
- 現代的な Markdown の標準

### 5.2 変換処理のパターン
```typescript
const htmlContent = mainContent.html() || "";
const markdownContent = turndownService.turndown(htmlContent);
```

**処理フロー:**
1. cheerio から HTML 文字列を取得
2. 空文字列フォールバック
3. turndown で Markdown に変換

## 6. データフィルタリングとマッピング

### 6.1 Array.map() の活用

#### 6.1.1 crates.io レスポンスの変換
```typescript
const crates = response.data.crates.map((crate: any) => ({
    name: crate.name,
    description: crate.description || "No description available",
    downloads: crate.downloads,
    version: crate.newest_version,
    documentation: crate.documentation,
}));
```

**特徴:**
- 不要なフィールドを除外
- `description` のフォールバック処理
- 一貫した型への変換

#### 6.1.2 Markdown 整形への map
```typescript
.map((crate: CrateSearchResult) =>
    `## ${crate.name} (${crate.version})\n\n` +
    `**Description:** ${crate.description}\n\n` +
    `**Downloads:** ${crate.downloads.toLocaleString()}\n\n` +
    `**Documentation:** ${crate.documentation || "N/A"}\n\n---\n`
)
.join("\n")
```

**テクニック:**
- テンプレートリテラルでフォーマット
- `toLocaleString()` で数値を読みやすく
- `|| "N/A"` で null 対応
- `join("\n")` で連結

### 6.2 Array.filter() による重複除去

```typescript
const uniqueItems = items.filter((item, index, self) =>
    index === self.findIndex(i =>
        i.name === item.name && i.type === item.type
    )
);
```

**アルゴリズム:**
1. 各要素について、配列内で最初に出現するインデックスを検索
2. 現在のインデックスと一致する場合のみ残す
3. 重複した要素は後の出現が除外される

**時間計算量:** O(n²)
- 小規模データセットでは問題なし
- 大規模化の場合は Set 使用を検討

### 6.3 cheerio の each() イテレーション

```typescript
$("#main-content a").each((_, element) => {
    const $link = $(element);
    const itemName = $link.text().trim();
    const itemLink = $link.attr("href") || "";

    if (!itemName || !itemLink) return;

    // 処理...
});
```

**パターン:**
- 第一引数（インデックス）は未使用 → `_` で明示
- `return` で早期リターン（スキップ）
- `trim()` で余分な空白を除去

## 7. 条件分岐とフィルタリングロジック

### 7.1 複合条件の設計

#### 7.1.1 検索マッチングロジック
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

**論理構造:**

**matchesQuery:**
- `!query`: query が未定義 → すべてマッチ
- `query == ""`: query が空文字列 → すべてマッチ
- `itemName.toLowerCase().includes(...)`: 部分一致検索

**matchesType:**
- `!item_type`: 型フィルタなし → すべてマッチ
- `item_type == ""`: 型フィルタなし → すべてマッチ
- `type === item_type`: 完全一致
- `itemName.toLowerCase().includes(item_type.toLowerCase())`: 名前に型が含まれる

**最終条件:**
- `matchesQuery && matchesType && type !== "unknown"`
- 両方の条件を満たし、かつ型が判定できている場合のみ

#### 7.1.2 型判定のカスケード
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

**設計原則:**
- デフォルト値を "unknown" に設定
- else-if チェーンで明確な優先順位
- docs.rs の URL 命名規則に依存

**リスク:**
- docs.rs が URL 構造を変更すると動作しなくなる
- 対策: 定期的な互換性テスト

### 7.2 ガード条件パターン

```typescript
if (!itemName || !itemLink) return;
```

**early return の利点:**
- ネストの削減
- 可読性の向上
- 無効なデータの早期除外

### 7.3 per_page の制限
```typescript
per_page: Math.min(per_page, 100)
```

**設計:**
- API の負荷制限
- `Math.min()` でシンプルに実装
- 100件以上のリクエストを防止

## 8. エラーハンドリングの詳細設計

### 8.1 try-catch の配置戦略

#### 8.1.1 外側の try-catch（setupToolHandlers内）
```typescript
try {
    switch (request.params.name) {
        case "docs_rs_search_crates":
            return await this.searchCrates(request.params.arguments);
        // ...
    }
} catch (error) {
    throw new McpError(
        ErrorCode.InternalError,
        `Error executing tool ${request.params.name}: ${error}`
    );
}
```

**役割:**
- すべてのツール実行エラーをキャッチ
- MCP プロトコルのエラーに変換
- 統一的なエラーレスポンス

#### 8.1.2 内側の try-catch（各ツールメソッド内）
```typescript
try {
    const response = await axios.get(...);
    // 処理...
} catch (error) {
    throw new Error(`Failed to search crates: ${error}`);
}
```

**役割:**
- 具体的なエラー情報を付加
- エラーメッセージのカスタマイズ
- デバッグ情報の提供

### 8.2 エラーメッセージの設計

#### 8.2.1 コンテキスト情報の含有
```typescript
`Failed to get item documentation for ${fullItemName}: ${error}`
```

**含まれる情報:**
- 操作の種類: "get item documentation"
- 対象: `${fullItemName}`
- 原因: `${error}`

**利点:**
- ユーザーが問題を特定しやすい
- ログから状況を再構築可能

#### 8.2.2 フォールバック時のメッセージ
```typescript
text: `# ${crate_name} Documentation\n\nNo documentation content found at ${url}`
```

**特徴:**
- エラーではなく、情報メッセージとして返す
- URL を含めてユーザーが手動で確認可能
- 処理は失敗させない（ユーザーフレンドリー）

## 9. 非同期処理の最適化テクニック

### 9.1 現在の実装パターン

```typescript
const response = await axios.get<string>(url);
const $ = cheerio.load(response.data);
```

**特徴:**
- 順次実行
- シンプルで理解しやすい

### 9.2 将来的な並列化の可能性

#### 9.2.1 複数ドキュメントの並列取得
```typescript
// 改善案
async function getMultipleItems(items: GetItemArgs[]) {
    const promises = items.map(item => this.getItem(item));
    return await Promise.all(promises);
}
```

**効果:**
- ネットワーク待機時間の削減
- スループットの向上

#### 9.2.2 リスクと対策
- **リスク**: docs.rs への負荷増大
- **対策**: レート制限の実装
  ```typescript
  // p-limit などのライブラリ使用例
  import pLimit from 'p-limit';
  const limit = pLimit(5); // 同時5リクエストまで

  const promises = items.map(item =>
      limit(() => this.getItem(item))
  );
  ```

## 10. URL とリンクの正規化

### 10.1 相対URLの処理
```typescript
link: itemLink.startsWith("http")
    ? itemLink
    : `https://docs.rs/${crate_name}/${version}/${crate_name}/${itemLink}`
```

**ロジック:**
- 絶対URL（http で始まる）はそのまま使用
- 相対URLは docs.rs のベースURLを付加

**考慮点:**
- docs.rs の HTML が相対パスを使用
- クロスリファレンスリンクへの対応

## 11. コードの保守性を高める設計

### 11.1 定数の外部化（改善案）

現在のハードコーディング:
```typescript
const url = `https://docs.rs/${crate_name}/${version}/${crate_name}/index.html`;
```

改善案:
```typescript
const DOCS_RS_BASE_URL = "https://docs.rs";
const CRATES_IO_API_BASE = "https://crates.io/api/v1";

const url = `${DOCS_RS_BASE_URL}/${crate_name}/${version}/${crate_name}/index.html`;
```

**メリット:**
- 一箇所での変更
- テスト時のモック化が容易

### 11.2 マジックナンバーの排除

現在:
```typescript
per_page: Math.min(per_page, 100)
```

改善案:
```typescript
const MAX_RESULTS_PER_PAGE = 100;
per_page: Math.min(per_page, MAX_RESULTS_PER_PAGE)
```

### 11.3 セレクタの外部化

現在:
```typescript
const mainContent = $(".rustdoc .docblock").first();
```

改善案:
```typescript
const SELECTORS = {
    README_MAIN: ".rustdoc .docblock",
    README_ALTERNATIVE: ".rustdoc-main .item-decl",
    ITEM_MAIN_CONTENT: "#main-content",
    ITEM_DECL: ".rustdoc .item-decl",
    ITEM_DOCBLOCK: ".rustdoc .docblock",
};

const mainContent = $(SELECTORS.README_MAIN).first();
```

**メリット:**
- docs.rs の HTML 構造変更への対応が容易
- セレクタの一覧性
- テストでの再利用

## 12. デバッグとロギング

### 12.1 現在のロギング
```typescript
console.error("docs.rs MCP server running on stdio");
```

**注意点:**
- `console.log` ではなく `console.error` を使用
- 理由: stdout は MCP プロトコル通信に使用される
- stderr はログ出力用

### 12.2 将来的なロギング戦略（改善案）

```typescript
// 環境変数によるデバッグモード
const DEBUG = process.env.DEBUG === "true";

function debugLog(message: string, data?: any) {
    if (DEBUG) {
        console.error(`[DEBUG] ${message}`, data || "");
    }
}

// 使用例
debugLog("Fetching URL", { url, crate_name });
```

## 13. テストの考慮事項

### 13.1 テスタビリティの向上（改善案）

#### 13.1.1 依存性注入
```typescript
class DocsRsMcpServer {
    constructor(
        private httpClient = axios,
        private htmlParser = cheerio,
        private markdownConverter = turndownService
    ) {
        // ...
    }
}
```

**メリット:**
- モックの注入が容易
- ユニットテストが書きやすい

#### 13.1.2 純粋関数の抽出
```typescript
// URL構築ロジックを純粋関数に
function buildItemUrl(
    crateName: string,
    version: string,
    itemType: string,
    itemPath: string
): string {
    const itemName = itemPath.split("::").pop();

    if (itemType === "module") {
        return `https://docs.rs/${crateName}/${version}/${itemPath.replaceAll("::", "/")}/index.html`;
    } else {
        const pathParts = itemPath.split("::");
        const modulePath = pathParts.slice(0, -1).join("/");
        return `https://docs.rs/${crateName}/${version}/${modulePath}/${itemType}.${itemName}.html`;
    }
}
```

**テスト例:**
```typescript
describe("buildItemUrl", () => {
    it("should build URL for struct", () => {
        const url = buildItemUrl(
            "wasmtime",
            "latest",
            "struct",
            "wasmtime::component::Component"
        );
        expect(url).toBe(
            "https://docs.rs/wasmtime/latest/wasmtime/component/struct.Component.html"
        );
    });
});
```

## 14. パフォーマンス最適化のポイント

### 14.1 メモリ使用量

#### 14.1.1 cheerio の効率性
```typescript
const $ = cheerio.load(response.data);
```

**特徴:**
- 軽量な DOM 実装
- フルブラウザエンジンより高速
- メモリフットプリント小

#### 14.1.2 文字列連結の最適化
```typescript
// 現在の実装
contentHtml += itemDecl.html() || "";
contentHtml += mainContent.html() || "";
```

**改善案（大量のデータの場合）:**
```typescript
const parts: string[] = [];
if (itemDecl.length > 0) parts.push(itemDecl.html() || "");
if (mainContent.length > 0) parts.push(mainContent.html() || "");
const contentHtml = parts.join("");
```

### 14.2 ネットワークリクエストの最適化

#### 14.2.1 タイムアウト設定（改善案）
```typescript
const response = await axios.get(url, {
    timeout: 10000, // 10秒
});
```

#### 14.2.2 リトライロジック（改善案）
```typescript
async function fetchWithRetry(url: string, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await axios.get(url);
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}
```

## 15. セキュリティ考慮事項

### 15.1 インジェクション対策

#### 15.1.1 URL構築の安全性
```typescript
const url = `https://docs.rs/${crate_name}/${version}/${crate_name}/index.html`;
```

**現状:**
- ユーザー入力をそのまま URL に使用
- docs.rs 側で適切にエスケープされることを前提

**改善案:**
```typescript
function sanitizeCrateName(name: string): string {
    // 英数字、ハイフン、アンダースコアのみ許可
    return name.replace(/[^a-zA-Z0-9\-_]/g, "");
}

const url = `https://docs.rs/${sanitizeCrateName(crate_name)}/...`;
```

### 15.2 エラーメッセージの情報漏洩

現在:
```typescript
throw new Error(`Failed to search crates: ${error}`);
```

**リスク:**
- スタックトレースが MCP クライアントに送信される可能性
- 内部実装の詳細が漏れる

**改善案:**
```typescript
throw new Error(`Failed to search crates: ${error.message || "Unknown error"}`);
```

## 16. 国際化 (i18n) の考慮

### 16.1 現在のハードコーディング
```typescript
description: crate.description || "No description available"
```

### 16.2 将来的な i18n 対応（改善案）
```typescript
const MESSAGES = {
    en: {
        noDescription: "No description available",
        noContent: "No documentation content found at",
    },
    ja: {
        noDescription: "説明がありません",
        noContent: "ドキュメントが見つかりませんでした:",
    },
};

const locale = process.env.LOCALE || "en";
const t = MESSAGES[locale];

description: crate.description || t.noDescription
```

## 17. コーディング規約とベストプラクティス

### 17.1 命名規則

- **クラス名**: PascalCase (`DocsRsMcpServer`)
- **メソッド名**: camelCase (`searchCrates`, `getReadMe`)
- **定数**: UPPER_SNAKE_CASE (改善案: `MAX_RESULTS_PER_PAGE`)
- **変数**: camelCase (`mainContent`, `itemName`)

### 17.2 コメントの戦略

現在のコード:
- 実装コメントなし
- 型定義でドキュメント代用

改善案:
```typescript
/**
 * Searches for Rust crates using the crates.io API
 * @param args - Search parameters including query, per_page, and sort
 * @returns MCP response with formatted Markdown results
 * @throws Error if the API request fails
 */
private async searchCrates(args: any): Promise<object> {
    // ...
}
```

### 17.3 関数の長さ

現在の `getItem()` は約70行:
- **判断**: やや長い
- **改善案**: ヘルパー関数への分割
  ```typescript
  private buildItemUrl(/* ... */): string { /* ... */ }
  private extractItemContent($: CheerioAPI): string { /* ... */ }
  private formatItemResponse(/* ... */): object { /* ... */ }
  ```

## 18. ビルドとデプロイメントの考慮

### 18.1 shebang の重要性
```typescript
#!/usr/bin/env node
```

**役割:**
- UNIX系システムでの直接実行を可能に
- `npx` での実行に必須

### 18.2 実行権限の付与
```json
"build": "tsc && chmod 755 build/index.js"
```

**理由:**
- コンパイル後のファイルに実行権限が必要
- `chmod 755`: 所有者に全権限、その他に読み取りと実行権限

### 18.3 CommonJS vs ESM

現在の設定:
```json
"type": "commonjs",
"module": "Node16"
```

**トレードオフ:**
- **CommonJS**: 広範な互換性
- **ESM**: モダンな標準、Tree Shaking

**現在の選択理由:**
- MCP SDK との互換性
- Node.js 18+ での安定性

## 19. 今後の拡張性

### 19.1 キャッシング機構の追加

```typescript
// 改善案
class SimpleCache {
    private cache = new Map<string, { data: any; timestamp: number }>();
    private ttl = 3600000; // 1時間

    get(key: string): any | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }

    set(key: string, data: any): void {
        this.cache.set(key, { data, timestamp: Date.now() });
    }
}
```

### 19.2 バージョン管理の改善

現在: `version = "latest"`

改善案:
```typescript
async function resolveLatestVersion(crateName: string): Promise<string> {
    const response = await axios.get(
        `https://crates.io/api/v1/crates/${crateName}`
    );
    return response.data.crate.newest_version;
}
```

### 19.3 追加ツールのアイデア

- `docs_rs_get_dependencies`: クレートの依存関係取得
- `docs_rs_get_versions`: 利用可能なバージョン一覧
- `docs_rs_get_examples`: サンプルコードの抽出

## 20. まとめ

本プロジェクトの実装は、以下の原則に基づいている:

1. **シンプルさ**: 複雑な抽象化を避け、直接的な実装
2. **堅牢性**: 複数のフォールバックで外部依存の変化に対応
3. **ユーザーフレンドリー**: エラー時も情報を提供
4. **拡張性**: 新しいツールの追加が容易な設計

今後の改善余地:
- 型安全性の強化 (zod の活用)
- テストカバレッジの追加
- パフォーマンス最適化 (キャッシング、並列化)
- エラーハンドリングの精緻化
