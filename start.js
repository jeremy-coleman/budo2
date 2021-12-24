const budo = require("./src/shader-reload/budo")
const browserify = require("browserify")
const path = require("path")

// a utility that attaches shader reloading capabilities to budo
const attachShaderReload = require("./src/shader-reload/budo-attach")

// root source
const entry = require.resolve("./src/example/regl")

const shaderReloadTransform = require("./src/shader-reload/transform")
process.env.NODE_PATH = path.resolve(__dirname, "src")

function start2() {
  const args = [entry].concat(process.argv.slice(2))
  const app = budo.cli(args, {
    //dir: path.resolve(__dirname, '../app'),
    //serve: 'bundle.js',
    live: false,
    browserify: {
      transform: [
        //'babelify',
        "glslify",
        shaderReloadTransform
      ]
    }
  })
  if (app) attachShaderReload(app)
  return app
}

function start1() {
    //const args = [entry].concat(process.argv.slice(2))
    const app = budo("./src/example/regl", {
      //dir: path.resolve(__dirname, '../app'),
      //serve: 'bundle.js',
      live: false,
      stream: process.stdout,
      browserify: {
        transform: [
          //'babelify',
          "glslify",
          shaderReloadTransform
        ]
      }
    })
    if (app) attachShaderReload(app)
    return app
  }

function start() {
    //const args = [entry].concat(process.argv.slice(2))
    const app = budo("./src/example/regl", {
      //dir: path.resolve(__dirname, '../app'),
      //serve: 'bundle.js',
      live: false,
      stream: process.stdout,
      browserify: {
        transform: [
          //'babelify',
          "glslify",
          shaderReloadTransform
        ]
      }
    })
    if (app) attachShaderReload(app)
    return app
  }


start()

// You could add more transforms here if you like
// const transforms = [
//     'babelify',
//     'glslify',
//     shaderReloadTransform
//   ];

//   // during development
//   function start() {
//     const args = [ entry ].concat(process.argv.slice(2));
//     const app = budo.cli(args, {
//       //dir: path.resolve(__dirname, '../app'),
//       //serve: 'bundle.js',
//       live: false,
//       browserify: {
//         transform: transforms //.concat([ 'shader-reload/transform' ])
//       }
//     });
//     if (app) attachShaderReload(app);
//     return app;
//   };

// create a file for production
// module.exports.bundle = function () {
//   const bundler = browserify(entry, {
//     fullPaths: process.env.DISC === '1'
//   });

//   // add common transforms
//   transforms.forEach(t => bundler.transform(t));

//   // add production transforms
//   return bundler
//     .transform('loose-envify', { global: true })
//     .transform('unreachable-branch-transform', { global: true })
//     .bundle();
// };

// if (!module.parent) {
//   if (process.env.NODE_ENV === 'production') {
//     module.exports.bundle().pipe(process.stdout);
//   } else {
//     module.exports.dev();
//   }
// }