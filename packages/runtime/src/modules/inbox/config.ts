import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

/**
 * 企业微信智能机器人入站配置 Schema
 */
export const WecomInboxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botId: z.string().optional().default(''),
  botSecret: z.string().optional().default(''),
  wsUrl: z.string().optional(),
});

export type WecomInboxConfig = z.infer<typeof WecomInboxConfigSchema>;

/**
 * Rover Inbox 总配置 Schema
 * 预留版本号及未来其他提供商（飞书、钉钉、外部网关等）的扩展槽位
 */
export const RoverInboxConfigSchema = z.object({
  version: z.number().default(1),
  wecom: WecomInboxConfigSchema.default({ enabled: false }),
});

export type RoverInboxConfig = z.infer<typeof RoverInboxConfigSchema>;

/**
 * 脱敏后的企业微信配置（供日志、前端回显使用）
 */
export interface MaskedWecomInboxConfig extends WecomInboxConfig {
  hasSecret: boolean;
  isMasked: boolean;
}

/**
 * 脱敏后的 Rover Inbox 配置
 */
export interface MaskedRoverInboxConfig {
  version: number;
  wecom: MaskedWecomInboxConfig;
}

/**
 * 获取 Inbox 配置文件持久化路径
 * 默认 ~/.rover/inbox.json，支持 ROVER_INBOX_CONFIG_PATH 环境变量覆盖
 */
export function getInboxConfigPath(): string {
  if (process.env.ROVER_INBOX_CONFIG_PATH) {
    return path.resolve(process.env.ROVER_INBOX_CONFIG_PATH);
  }
  return path.join(os.homedir(), '.rover', 'inbox.json');
}

/**
 * 获取默认配置模版
 */
export function getDefaultInboxConfig(): RoverInboxConfig {
  return {
    version: 1,
    wecom: {
      enabled: false,
      botId: '',
      botSecret: '',
    },
  };
}

/**
 * 对密钥字符串进行掩码脱敏
 */
export function maskSecret(secret?: string): string {
  if (!secret) return '';
  const trimmed = secret.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

/**
 * 掩码脱敏企业微信配置
 */
export function maskWecomConfig(config: WecomInboxConfig): MaskedWecomInboxConfig {
  return {
    ...config,
    botSecret: maskSecret(config.botSecret),
    hasSecret: Boolean(config.botSecret && config.botSecret.trim().length > 0),
    isMasked: true,
  };
}

/**
 * 掩码脱敏全量配置
 */
export function maskInboxConfig(config: RoverInboxConfig): MaskedRoverInboxConfig {
  return {
    version: config.version,
    wecom: maskWecomConfig(config.wecom),
  };
}

/**
 * 从本地磁盘加载 Inbox 配置
 * 磁盘文件为 Single Source of Truth，若不存在则创建默认文件
 */
export function loadInboxConfig(customPath?: string): RoverInboxConfig {
  const filePath = customPath || getInboxConfigPath();

  if (!fs.existsSync(filePath)) {
    const defaultConfig = getDefaultInboxConfig();
    saveInboxConfig(defaultConfig, filePath);
    return defaultConfig;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return RoverInboxConfigSchema.parse(parsed);
  } catch (error) {
    console.error(`[Rover Inbox Config] 加载配置失败 (${filePath}):`, error);
    throw new Error(
      `加载 Inbox 配置失败 (${filePath}): ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 原子落盘保存 Inbox 配置（0600 安全权限）
 */
export function saveInboxConfig(config: RoverInboxConfig, customPath?: string): void {
  const filePath = customPath || getInboxConfigPath();
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const validated = RoverInboxConfigSchema.parse(config);
  const jsonStr = JSON.stringify(validated, null, 2);

  // 通过临时文件重命名实现原子写
  const tmpPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  fs.writeFileSync(tmpPath, jsonStr, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // 忽略不支持 posix mode 的文件系统错误
  }
}
