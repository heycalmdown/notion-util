import Telegraf, { TelegramOptions, LaunchPollingOptions, LaunchWebhookOptions, Middleware, ContextMessageUpdate } from 'telegraf';
import { COMMANDS, onText, onStart, errorCatcher } from './handlers';

interface NotionUtilConfig {
  token_env: string;
  telegram_opts: TelegramOptions;
  launch_opts: {
    polling?: LaunchPollingOptions,
    webhook?: LaunchWebhookOptions
  };
}

const CONFIGS: {[key: string]: NotionUtilConfig} = {};

CONFIGS['beta'] = {
  token_env: 'TELEGRAM_BETA_TOKEN',
  telegram_opts: {},
  launch_opts: {}
};

CONFIGS['bot'] = {
  token_env: 'TELEGRAM_TOKEN',
  telegram_opts: { webhookReply: false },
  launch_opts: {
    webhook: {
      hookPath: '/secret-path',
      port: parseInt(process.env.PORT!, 10) || 8080
    }
  }
};

const CONFIG = CONFIGS[process.env.CONFIG || 'beta'];

async function main() {
  const telegram = new Telegraf(process.env[CONFIG.token_env], { telegram: CONFIG.telegram_opts });

  telegram.start(onStart);
  COMMANDS.forEach(c => telegram.command(c[0], errorCatcher(c[1])));
  telegram.on('text', errorCatcher(onText));

  await telegram.launch(CONFIG.launch_opts);
}

main();
