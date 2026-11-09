// 作用：提供一个只用于本地验证的 OpenAI 兼容 HTTP 服务。
import http from "node:http"; // 作用：使用 Node 内置 HTTP 服务，避免额外依赖。

const port = Number(process.argv[2] || 4010); // 作用：允许集成测试通过命令行指定监听端口。

const sendJson = (response, status, body) => { // 作用：用 OpenAI 兼容的 JSON 响应结束请求。
  response.writeHead(status, { "content-type": "application/json" }); // 作用：设置状态码和 JSON 内容类型。
  response.end(JSON.stringify(body)); // 作用：序列化响应对象并发送给客户端。
}; // 作用：结束 JSON 响应辅助函数。

const sendStream = (response, model) => { // 作用：向客户端发送最小可用的 SSE 流。
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }); // 作用：声明 OpenAI 流式响应所需的 HTTP 头。
  response.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: { role: "assistant", content: "mock response" }, finish_reason: null }] })}\n\n`); // 作用：发送第一段助手文本。
  response.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`); // 作用：发送结束原因，验证客户端能正常收束流。
  response.end("data: [DONE]\n\n"); // 作用：发送 OpenAI SSE 的结束标记并关闭连接。
}; // 作用：结束 SSE 响应辅助函数。

const sendToolStream = (response, model) => { // 作用：向客户端发送一个流式工具调用，验证工具事件不会被插件吞掉。
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }); // 作用：声明工具调用也使用 OpenAI SSE 响应格式。
  const toolCall = { index: 0, id: "call_test", type: "function", function: { name: "demo_tool", arguments: JSON.stringify({ ok: true }) } }; // 作用：构造标准 OpenAI 工具调用增量并避免手写嵌套转义。
  response.write(`data: ${JSON.stringify({ id: "chatcmpl-tool", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [toolCall] }, finish_reason: null }] })}\n\n`); // 作用：发送带函数名和 JSON 参数的工具调用增量。
  response.write(`data: ${JSON.stringify({ id: "chatcmpl-tool", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`); // 作用：发送工具调用结束原因。
  response.end("data: [DONE]\n\n"); // 作用：结束工具调用 SSE 流。
}; // 作用：结束流式工具调用辅助函数。

const server = http.createServer(async (request, response) => { // 作用：处理模型列表和聊天完成请求。
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`); // 作用：解析请求路径，兼容不同 Host 头。
  if (url.pathname.endsWith("/models")) { // 作用：识别 OpenAI 模型列表端点。
    sendJson(response, 200, { object: "list", data: [{ id: "demo-model", object: "model", owned_by: "mock" }] }); // 作用：返回一个可被插件转换的模型列表。
    return; // 作用：避免模型列表请求继续落入聊天分支。
  } // 作用：结束模型列表分支。
  if (url.pathname.endsWith("/chat/completions")) { // 作用：识别 OpenAI Chat Completions 端点。
    let body = ""; // 作用：准备收集请求体以判断是否要求流式输出。
    for await (const chunk of request) body += chunk; // 作用：读取客户端发送的 JSON 请求体。
    const payload = JSON.parse(body || "{}"); // 作用：解析请求体并获得模型和 stream 字段。
    const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0; // 作用：判断网关是否把工具定义传给了上游。
    if (payload.stream) { // 作用：按客户端要求走 SSE 流式响应。
      if (hasTools) sendToolStream(response, payload.model || "demo-model"); // 作用：工具请求返回工具调用事件，验证端到端工具流。
      else sendStream(response, payload.model || "demo-model"); // 作用：普通请求返回文本流。
      return; // 作用：避免流式请求继续走非流式响应。
    } // 作用：结束流式分支。
    if (hasTools) { // 作用：处理非流式工具调用请求。
      sendJson(response, 200, { id: "chatcmpl-tool", object: "chat.completion", created: 1, model: payload.model || "demo-model", choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "call_test", type: "function", function: { name: "demo_tool", arguments: JSON.stringify({ ok: true }) } }] }, finish_reason: "tool_calls" }] }); // 作用：返回标准 OpenAI 工具调用消息。
      return; // 作用：结束非流式工具请求处理。
    } // 作用：结束非流式工具分支。
    sendJson(response, 200, { id: "chatcmpl-test", object: "chat.completion", created: 1, model: payload.model || "demo-model", choices: [{ index: 0, message: { role: "assistant", content: "mock response" }, finish_reason: "stop" }] }); // 作用：返回最小的非流式完成响应。
    return; // 作用：结束聊天请求处理。
  } // 作用：结束聊天端点分支。
  sendJson(response, 404, { error: { message: "mock endpoint not found", type: "invalid_request_error" } }); // 作用：让未覆盖的路径明确返回 OpenAI 错误形状。
}); // 作用：结束 HTTP 服务定义。

server.listen(port, "127.0.0.1", () => { // 作用：只在本机开放测试服务，避免暴露模拟接口。
  process.stdout.write(`mock-openai-server listening on ${port}\n`); // 作用：把启动状态写到标准输出，便于集成测试确认。
}); // 作用：结束监听启动逻辑。
