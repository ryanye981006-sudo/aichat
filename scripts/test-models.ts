// 测试阿里云 DashScope 向量嵌入模型和 rerank 模型的 API 调用

const API_KEY = "sk-9c8dd90c4386426db75c9833b6ec8b8e";
const EMBEDDING_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";
const RERANK_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/rerank";

const EMBEDDING_MODEL = "text-embedding-v4";
const RERANK_MODEL = "qwen3-vl-rerank";

// ============================================
// 测试向量嵌入模型
// ============================================
async function testEmbedding() {
  console.log("========== 测试向量嵌入模型 ==========");
  console.log(`模型: ${EMBEDDING_MODEL}`);
  console.log(`地址: ${EMBEDDING_URL}`);

  const payload = {
    model: EMBEDDING_MODEL,
    input: ["人工智能是未来的发展方向", "机器学习是人工智能的重要分支"],
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(EMBEDDING_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ 响应不是有效的JSON:", text.slice(0, 500));
      return null;
    }

    if (!response.ok) {
      console.error("❌ 请求失败 (状态码:", response.status, "):", data);
      return null;
    }

    console.log("✅ 请求成功!");
    console.log(`返回数据条数: ${data.data?.length ?? 0}`);

    // 打印第一条向量的基本信息
    if (data.data?.[0]) {
      const first = data.data[0];
      console.log(`向量维度: ${first.embedding?.length ?? "未知"}`);
      console.log(`索引: ${first.index}`);
      console.log(`前5个向量值: ${first.embedding?.slice(0, 5).map((v: number) => v.toFixed(4)).join(", ")}...`);
    }

    return data;
  } catch (error: any) {
    console.error("❌ 请求异常:", error.message);
    if (error.name === "AbortError") {
      console.error("   请求超时（60秒），请检查网络连接");
    }
    return null;
  }
}

// ============================================
// 测试 rerank 模型（兼容模式）
// ============================================
async function testRerankCompatible() {
  console.log("\n========== 测试 Rerank 模型 (兼容模式) ==========");
  console.log(`模型: ${RERANK_MODEL}`);
  console.log(`地址: ${RERANK_URL}`);

  const payload = {
    model: RERANK_MODEL,
    query: "什么是人工智能",
    documents: [
      "人工智能是计算机科学的一个分支，致力于开发能够模拟人类智能的系统",
      "机器学习是人工智能的核心技术之一",
      "今天天气很好，适合出去散步",
      "深度学习使用神经网络来处理复杂的数据模式",
    ],
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(RERANK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const text = await response.text();

    if (response.status === 404) {
      console.log("⚠️  端点返回 404 - 该兼容模式端点 (/compatible-mode/v1/rerank) 可能未启用");
      console.log("   建议尝试原生 DashScope API: /api/v1/services/rerank/text-rerank/text-rerank");
      return null;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ 响应不是有效的JSON:", text.slice(0, 500));
      return null;
    }

    if (!response.ok) {
      console.error("❌ 请求失败 (状态码:", response.status, "):", data);
      return null;
    }

    console.log("✅ 请求成功!");
    const results = data.results ?? data.data ?? [];
    console.log(`返回结果条数: ${results.length}`);

    console.log("\n相关性排序（从高到低）:");
    for (const item of results) {
      const index = item.index ?? item.document_index;
      const score = item.relevance_score ?? item.score;
      console.log(`  [${index}] 得分: ${score.toFixed(4)} - ${payload.documents[index]}`);
    }

    return data;
  } catch (error: any) {
    console.error("❌ 请求异常:", error.message);
    if (error.name === "AbortError") {
      console.error("   请求超时（60秒），请检查网络连接");
    }
    return null;
  }
}

// ============================================
// 测试 rerank 模型（原生 DashScope API）
// ============================================
async function testRerankNative() {
  console.log("\n========== 测试 Rerank 模型 (原生 DashScope API) ==========");
  console.log(`模型: ${RERANK_MODEL}`);
  console.log(`地址: https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank`);

  const payload = {
    model: RERANK_MODEL,
    input: {
      query: "什么是人工智能",
      documents: [
        { text: "人工智能是计算机科学的一个分支，致力于开发能够模拟人类智能的系统" },
        { text: "机器学习是人工智能的核心技术之一" },
        { text: "今天天气很好，适合出去散步" },
        { text: "深度学习使用神经网络来处理复杂的数据模式" },
      ],
    },
  };

  const url = "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ 响应不是有效的JSON:", text.slice(0, 500));
      return null;
    }

    if (!response.ok) {
      console.error("❌ 请求失败 (状态码:", response.status, "):", data);
      return null;
    }

    console.log("✅ 请求成功!");
    const results = data.output?.results ?? [];
    console.log(`返回结果条数: ${results.length}`);

    const docs = payload.input.documents;
    console.log("\n相关性排序（从高到低）:");
    for (const item of results) {
      const index = item.index;
      const score = item.relevance_score;
      console.log(`  [${index}] 得分: ${score.toFixed(4)} - ${docs[index].text}`);
    }

    return data;
  } catch (error: any) {
    console.error("❌ 请求异常:", error.message);
    if (error.name === "AbortError") {
      console.error("   请求超时（60秒），请检查网络连接");
    }
    return null;
  }
}

// ============================================
// 主函数
// ============================================
async function main() {
  console.log(`开始测试 DashScope API (时间: ${new Date().toLocaleString("zh-CN")})\n`);

  const embeddingResult = await testEmbedding();
  const rerankCompatResult = await testRerankCompatible();
  const rerankNativeResult = await testRerankNative();

  console.log("\n========== 测试总结 ==========");
  console.log(`向量嵌入模型 (${EMBEDDING_MODEL}):        ${embeddingResult ? "✅ 通过" : "❌ 失败"}`);
  console.log(`Rerank 兼容模式 (${RERANK_MODEL}):       ${rerankCompatResult ? "✅ 通过" : "❌ 失败 (404/不可用)"}`);
  console.log(`Rerank 原生 API (${RERANK_MODEL}):       ${rerankNativeResult ? "✅ 通过" : "❌ 失败"}`);
}

main();
