# shader-reload-cli/budo/glslify wombo combo

currently running 2 servers for app and shader playground.
app is using esbuild to prebuild since babylon is so large, not really neccessary tho, browserify will bundle in ~10s

you can hot reload shaders in the pg. try changing a glColorFrag, the frag shader will hot reload without resetting the vertex positions. pretty cool.


notes for future me:

explain why cjs is a better format for prebundling and esm is best for client, not build time.

add gulpy
add yerna
add cli standalone package
add mdx support
add ts transform support

[major]
refactor all community transforms
remove file ext check and replace with (yet to be created) transform factory
consider unplugin but unlikely
create abstract transform with a configure() option
configure object properties brainstorming:

test: regexp (file extension test)
include: glob
exclude: glob


the refactored transforms, using the default value that the originals had hard coded


[major]
refactor module-deps
remove global transforms
give some more thought on regexp vs acorn for detective
place to add acorn transforms
this is also the entry for a fanout impl (change order in mdep)
impl idea: tfilter globalTransforms and remove transforms

[major]
remove unneccessary builtin transforms on the browserify emitter and move these to independent default transforms



[major]
multi fs ie: file, tar, zip, remote, git

[minor]
import map support. merge with package.json.browser options

[minor]
configurable prelude, with a preset default esm wrapper. explore module registry or babylon.scriptcomponent

[minor]
replace shasum's createHash with wasm xxHash

[notes]
the shader-reload-cli is kind of useless now that budo has it by default .. so just use budo

budo.cli provides an opportunity to merge cli args using subarg format from a config file (need to implement)

THREE stuff doesnt work with recent versions of three. Not going to bother fixing it since it will likely break again in a matter of weeks