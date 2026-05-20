module.exports = {
  apps: [
    {
      name: "site-analysis",
      cwd: "/home/bitnami/site-analysis",
      script: ".next/standalone/server.js",
      env: {
        NODE_ENV: "production",
        PORT: "3002",
      },
      error_file: "/home/bitnami/site-analysis/logs/error.log",
      out_file: "/home/bitnami/site-analysis/logs/out.log",
      merge_logs: true,
      time: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      min_uptime: "10s",
    },
  ],
};
