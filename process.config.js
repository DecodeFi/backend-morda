module.exports = {
    apps: [
      {
        name: 'backend-server', // your app name
        script: 'server.js',        // entry point
        cwd: './src',
        instances: 1,               // number of instances (1 = single, or "max" for all CPU cores)
        autorestart: true,          // auto-restart on crash
        watch: ['.'],               // watch files and restart on changes (good for dev)
      },
    ],
};
  