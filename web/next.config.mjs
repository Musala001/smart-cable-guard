/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  serverExternalPackages: ["onnxruntime-node", "sharp"],
  outputFileTracingIncludes: {
    "/api/detect": [
      "./models/**",
      "./node_modules/onnxruntime-node/bin/**",
    ],
  },
};
export default nextConfig;
