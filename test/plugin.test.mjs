// 作用：使用 Node 内置测试框架验证插件的 provider、登录、模型列表和请求加载器。
import test from "node:test"; // 作用：提供无需额外依赖的测试运行器。
import assert from "node:assert/strict"; // 作用：提供失败即退出的严格断言。
import { MagpieOpenAICompatible } from "../index.mjs"; // 作用：加载待测试的唯一插件入口。

test("config declares an OpenAI-compatible provider", async () => { // 作用：验证插件会声明 Magpie 所需的 provider 配置。
  const hooks = await MagpieOpenAICompatible({}, { baseUrl: "http://127.0.0.1:4010/v1", defaultModel: "demo-model" }); // 作用：使用本地地址和固定模型创建插件实例。
  const config = {}; // 作用：准备 Magpie 会传给 config hook 的空配置。
  await hooks.config(config); // 作用：执行插件的 provider 配置逻辑。
  assert.equal(config.provider["eve-ai"].api, "http://127.0.0.1:4010/v1"); // 作用：确认 provider 使用了规范化后的 API 地址。
  assert.equal(config.provider["eve-ai"].models["demo-model"].tool_call, true); // 作用：确认模型声明支持工具调用。
}); // 作用：结束 provider 配置测试。

test("loader adds the configured API key header", async () => { // 作用：验证 API Key 会进入每个模型请求的认证头。
  const hooks = await MagpieOpenAICompatible({}, { baseUrl: "https://example.test/v1" }); // 作用：创建一个指向测试地址的插件实例。
  const loaded = await hooks.auth.loader(async () => ({ type: "api", key: "test-key" })); // 作用：模拟 Magpie 提供已保存的 API Key。
  assert.equal(loaded.baseURL, "https://example.test/v1"); // 作用：确认 loader 返回了正确的请求基地址。
  assert.equal(loaded.headers.Authorization, "Bearer test-key"); // 作用：确认默认 Bearer 认证格式正确。
}); // 作用：结束 API Key 测试。

test("models hook maps an OpenAI model list", async () => { // 作用：验证 OpenAI /models 响应能转换成 Magpie 模型表。
  const originalFetch = globalThis.fetch; // 作用：保存进程原有 fetch，避免测试结束后污染运行环境。
  globalThis.fetch = async (input, init) => { // 作用：用本地模拟响应替代真实网络请求。
    assert.equal(String(input), "https://example.test/v1/models"); // 作用：确认插件访问了标准 /models 路径。
    assert.equal(init.headers.Authorization, "Bearer test-key"); // 作用：确认模型列表请求带上了 API Key。
    return new Response(JSON.stringify({ data: [{ id: "demo-model", name: "Demo Model" }] }), { status: 200, headers: { "content-type": "application/json" } }); // 作用：返回一个符合 OpenAI 形状的模型列表。
  }; // 作用：结束模拟 fetch 定义。
  try { // 作用：确保无论断言是否失败都能恢复全局 fetch。
    const hooks = await MagpieOpenAICompatible({}, { baseUrl: "https://example.test/v1" }); // 作用：创建使用模拟地址的插件实例。
    const models = await hooks.provider.models({ models: {} }, { auth: { type: "api", key: "test-key" } }); // 作用：执行动态模型列表加载。
    assert.equal(models["demo-model"].name, "Demo Model"); // 作用：确认模型 id 和名称被正确保留。
    assert.equal(models["demo-model"].tool_call, true); // 作用：确认默认工具调用能力被声明。
  } finally { // 作用：进入清理分支。
    globalThis.fetch = originalFetch; // 作用：恢复真实 fetch，隔离其他测试。
  } // 作用：结束清理分支。
}); // 作用：结束模型列表测试。

test("custom auth header options are honored", async () => { // 作用：验证兼容某些使用自定义认证头的网关。
  const hooks = await MagpieOpenAICompatible({}, { baseUrl: "https://example.test/v1", authHeader: "x-api-key", authPrefix: "" }); // 作用：创建使用 x-api-key 且不带前缀的插件实例。
  const loaded = await hooks.auth.loader(async () => ({ type: "api", key: "custom-key" })); // 作用：模拟 Magpie 提供自定义网关密钥。
  assert.equal(loaded.headers["x-api-key"], "custom-key"); // 作用：确认自定义认证头和值均被保留。
}); // 作用：结束自定义认证头测试。
