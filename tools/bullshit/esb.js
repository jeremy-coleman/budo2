var esbuild = require("esbuild")

var fs = require("fs")
fs.mkdirSync("public", { recursive: true })

const bundle = () => {
  //const {lessLoader} = require("esbuild-plugin-less")
  esbuild.build({
      define: {
        "process.env.NODE_ENV": '"production"'
      },
      bundle: true,
      minify: true,
      loader: {
        ".svg": "file",
        '.wgsl': 'text',
      },
      format: "iife",
      //plugins: [lessLoader()],
      //outdir: "public",
      outfile: "./public/app.js",
      entryPoints: ["src/platformer/app.tsx"],
      platform: "browser"
    })
}

bundle()