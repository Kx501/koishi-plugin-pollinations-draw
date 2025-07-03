import { Context, Random, Schema, h } from "koishi";
import { } from "@koishijs/translator";

export const name = "pollinations-draw";
export const inject = {
  required: ["http"],
  optional: ["translator"],
};

export const usage = `
---
**免责声明**

感谢您使用我们的插件！请您仔细阅读以下条款，以确保您了解并接受我们的政策：

1. **隐私保护**：本插件不会收集或保存用户的个人信息。请确保上传到插件的图片不包含敏感或个人隐私信息。
2. **法律责任**：一旦启用本插件，即视为您同意遵守国家相关法律法规，如有违反，一切后果由您自行承担。
3. **免责声明更新**：我们保留随时修改本声明的权利，请及时更新插件以获取最新版本的免责声明。**若因未及时更新插件而导致的责任和损失，本方概不负责**。
4. **解释权归属**：本声明的最终解释权归插件开发者所有。
---

通过使用本插件，即视为**同意上述条款**。请确保您已经仔细阅读并理解以上内容。
`;

export interface Config {
  defaultWidth: number;
  defaultHeight: number;
  defaultModel: "Flux" | "Turbo";
  enableEnhance: boolean;
  nologo: boolean;
  safe: boolean;
  output: "仅图片" | "详细信息";
  autoTranslate: {
    enable?: boolean;
    sourceLang?: string;
    targetLang?: string;
  };
  timeout: number;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    defaultWidth: Schema.number().default(1024).description("默认图片宽度"),
    defaultHeight: Schema.number().default(1024).description("默认图片高度"),
    defaultModel: Schema.union(["Flux", "Turbo"])
      .default("Flux")
      .description("生成模型"),
    enableEnhance: Schema.boolean()
      .default(false)
      .description("启用官方提示词增强"),
    nologo: Schema.boolean().default(false).description("是否去除水印"),
    safe: Schema.boolean().default(true).description("是否启用官方内容审查"),
    output: Schema.union(["仅图片", "详细信息"])
      .default("仅图片")
      .description("输出方式"),
    autoTranslate: Schema.intersect([
      Schema.object({
        enable: Schema.boolean()
          .default(false)
          .description(" 翻译提示词，配合AI翻译可自定义修改提示词"),
      }),
      Schema.union([
        Schema.object({
          enable: Schema.const(true).required(),
          sourceLang: Schema.string().default("zh").description("源语言代码"),
          targetLang: Schema.string().default("en").description("目标语言代码"),
        }),
        Schema.object({}),
      ]),
    ]),
    timeout: Schema.number().default(30000).description("超时时间"),
  }),
]).description("插件配置");

export function apply(ctx: Context, config: Config) {
  ctx
    .command("pd <prompt:text>", "使用 Pollinations.AI 生成图片")
    .usage(`pd -[选项] <提示词>`)
    .option("size", "-z <宽x高:string>", { fallback: config.defaultWidth + 'x' + config.defaultHeight })
    .option("seed", "-s <种子:string>")
    .option("model", "-m <模型:string>", { fallback: config.defaultModel })
    .option("enhance", "-e 提示词增强", { type: "boolean", fallback: config.enableEnhance })
    .option("nologo", "-n 无水印", { type: "boolean", fallback: config.nologo })
    .action(async ({ session, options }, prompt) => {
      if (!prompt) return "请输入图片描述";

      try {
        // 翻译处理
        let finalPrompt = prompt;
        if (config.autoTranslate) {
          try {
            const translation = await ctx.translator.translate({
              input: prompt,
              source: config.autoTranslate.sourceLang,
              target: config.autoTranslate.targetLang,
            });
            finalPrompt = translation;
          } catch (error) {
            ctx.logger("pollinations").warn("翻译失败:", error);
            session?.send("提示词翻译失败，已使用原文");
          }
        }

        // 构造请求参数
        const sizeRegex = /[xX×,，*]/;
        const [width, height] = options.size.split(sizeRegex).map(s => s.trim());
        const seed = options?.seed || Random.int(0, 999999999).toString()

        const params = new URLSearchParams({
          private: "true",
          model: options.model,
          width: width,
          height: height,
          enhance: options.enhance ? "true" : "false",
          seed: seed,
          nologo: options.nologo ? "true" : "false",
          safe: config.safe.toString(),
        });

        // 编码提示词并构造URL
        const encodedPrompt = encodeURIComponent(finalPrompt);
        const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?${params}`;

        // 发送请求
        // 添加超时处理
        const response = await ctx.http.get(url, {
          responseType: "arraybuffer",
          headers: { Accept: "image/*" },
          timeout: config.timeout
        });

        if (config.output === "详细信息")
          return (`
${h.image(Buffer.from(response), "image/png")}
模型：${options.model}
宽高：${width}x${height}
种子：${seed}
          `);
        else return h.image(Buffer.from(response), "image/png");
      } catch (error) {
        ctx.logger("pollinations").warn(error);
        const status = error.response?.status || "未知";
        return `图片生成失败（状态码：${status}）`;
      }
    });
}
