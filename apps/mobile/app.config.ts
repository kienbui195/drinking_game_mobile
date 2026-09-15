import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const production = process.env.EAS_BUILD_PROFILE === 'production';
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (process.env.EAS_BUILD && (!apiUrl || (production && !apiUrl.startsWith('https://')))) {
    throw new Error('Set EXPO_PUBLIC_API_URL for EAS build; production requires an HTTPS backend.');
  }
  return {
    ...config,
    name: 'Chạm Ly',
    slug: 'cham-ly-mobile',
    plugins: [
      'expo-secure-store',
      ['expo-build-properties', { android: { usesCleartextTraffic: !production } }],
    ],
  };
};
