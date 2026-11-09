// 作用：为 Magpie 提供一个可配置的 OpenAI 兼容模型提供方。
const PROVIDER_ID = "eve-ai"; // 作用：使用短而独立的 provider id，避免覆盖 Magpie 内置的 openai 提供方。
const DEFAULT_BASE_URL = "https://api.openai.com/v1"; // 作用：没有插件选项时默认连接 OpenAI 官方兼容端点。
const DEFAULT_MODEL = "gpt-4o-mini"; // 作用：模型列表接口不可用时提供一个可测试的回退模型。
const DEFAULT_CONTEXT = 128000; // 作用：为未返回能力信息的模型提供保守的上下文长度。
const DEFAULT_OUTPUT = 16384; // 作用：为未返回能力信息的模型提供保守的最大输出长度。

// 作用：去掉地址末尾斜杠，避免拼接 API 路径时出现双斜杠。
const normalizeBaseUrl = (value) => String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");

// 作用：将认证配置转换成 OpenAI 兼容接口常见的请求头。
const makeAuthHeaders = (auth, options) => {
  const key = auth?.key;
  if (!key) return {};
  const header = String(options.authHeader || "Authorization");
  const prefix = String(options.authPrefix ?? "Bearer").trim();
  return { [header]: prefix ? `${prefix} ${key}` : key };
};

// 作用：从插件选项中读取某个模型的能力覆盖值。
const readModelOverride = (options, id) => {
  const overrides = options.modelOverrides;
  if (!overrides || typeof overrides !== "object") return {};
  const override = overrides[id];
  return override && typeof override === "object" ? override : {};
};

// 作用：把 OpenAI /models 返回的一项转换成 Magpie 能识别的模型描述。
const toMagpieModel = (raw, options) => {
  const id = String(raw?.id || "").trim();
  if (!id) return null;
  const override = readModelOverride(options, id);
  return {
    id,
    name: String(override.name || raw.name || id),
    limit: {
      context: Number(override.context || raw.context_window || raw.context || DEFAULT_CONTEXT),
      output: Number(override.output || raw.max_output_tokens || raw.max_output || DEFAULT_OUTPUT),
    },
    reasoning: Boolean(override.reasoning ?? true),
    tool_call: Boolean(override.tool_call ?? true),
    modalities: override.modalities || { input: ["text", "image"], output: ["text"] },
    ...(override.cost ? { cost: override.cost } : {}),
    ...(override.variants ? { variants: override.variants } : {}),
  };
};

// 作用：在模型列表请求失败时保留 Magpie 已经知道的模型，避免临时网络故障导致 provider 消失。
const fallbackModels = (provider) => provider?.models || {
  [DEFAULT_MODEL]: toMagpieModel({ id: DEFAULT_MODEL, name: DEFAULT_MODEL }, {}),
};

// 作用：导出唯一的插件函数，让 Magpie 按 OpenCode v1 插件形状加载它。
export const MagpieOpenAICompatible = async (_input, rawOptions) => {
  const options = rawOptions && typeof rawOptions === "object" ? rawOptions : {};
  const baseURL = normalizeBaseUrl(options.baseUrl || options.baseURL);
  const providerName = String(options.providerName || "Eve AI");
  const defaultModel = String(options.defaultModel || DEFAULT_MODEL);
  const initialModel = toMagpieModel({ id: defaultModel, name: defaultModel }, options);
  return {
    config: async (cfg) => {
      cfg.provider ??= {};
      cfg.provider[PROVIDER_ID] ??= {
        name: providerName,
        npm: "@ai-sdk/openai-compatible",
        api: baseURL,
        models: { [defaultModel]: initialModel },
      };
    },
    auth: {
      provider: PROVIDER_ID,
      methods: [{ type: "api", label: "Eve AI API key", placeholder: "sk-…" }],
      async loader(getAuth) {
        const auth = await getAuth();
        if (auth?.type !== "api" || !auth.key) return {};
        return { baseURL, headers: makeAuthHeaders(auth, options) };
      },
    },
    provider: {
      id: PROVIDER_ID,
      async models(provider, { auth } = {}) {
        if (auth?.type !== "api" || !auth.key) return fallbackModels(provider);
        const response = await fetch(`${baseURL}/models`, {
          headers: { ...makeAuthHeaders(auth, options), accept: "application/json" },
        });
        if (!response.ok) return fallbackModels(provider);
        const payload = await response.json();
        const models = Array.isArray(payload?.data)
          ? payload.data.map((model) => toMagpieModel(model, options)).filter(Boolean)
          : [];
        if (!models.length) return fallbackModels(provider);
        return Object.fromEntries(models.map((model) => [model.id, model]));
      },
    },
  };
};
