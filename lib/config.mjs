// Konfiguration aus der Umgebung. Zugangsdaten werden nie geloggt.
export function loadConfig(env = process.env) {
  return {
    port: Number.parseInt(env.PORT ?? '', 10),
    host: env.HOST || '127.0.0.1',
    databaseUrl: env.DATABASE_URL || null,
    s3: {
      endpoint: env.S3_ENDPOINT || null,
      region: env.S3_REGION || 'us-east-1',
      bucket: env.S3_BUCKET || null,
      accessKeyId: env.S3_ACCESS_KEY_ID || null,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || null,
    },
    paymentProviderUrl: env.PAYMENT_PROVIDER_URL || 'https://api.paynord.example.invalid/v1',
  };
}

export function assertConfig(config) {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.s3.endpoint) missing.push('S3_ENDPOINT');
  if (!config.s3.bucket) missing.push('S3_BUCKET');
  if (!config.s3.accessKeyId) missing.push('S3_ACCESS_KEY_ID');
  if (!config.s3.secretAccessKey) missing.push('S3_SECRET_ACCESS_KEY');
  if (missing.length) {
    const err = new Error(`Fehlende Umgebungsvariablen: ${missing.join(', ')}`);
    err.code = 'config_missing';
    throw err;
  }
}
