module.exports = {
  apps: [
    {
      name: "testado-api",
      script: "apps/api/dist/server.js",
      cwd: __dirname,
      env: { PORT: "3011" },
    },
    {
      name: "testado-web",
      script: "npm",
      args: "run start -w @testado/web",
      cwd: __dirname,
    },
  ],
};
