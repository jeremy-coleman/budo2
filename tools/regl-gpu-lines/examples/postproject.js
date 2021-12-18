const regl = createREGL({
  extensions: ['ANGLE_instanced_arrays']
});
const mat4 = glMatrix.mat4;

// This example illustrates the postproject property. You may specify a function to be applied
// *after* screne-space projection. Together with providing viewportSize, this allows you to
// draw lines in whatever viewport you desire, then to project them to the screen. This useful,
// for example, when drawing lines on a flat surface. It changes nothing if the lines are not
// on a flat surface, though the joins may not look particularly good in the out-of-plane
// dimension.
const drawLines = reglLines(regl, {
  vert: `
    precision highp float;

    // Use a vec2 attribute to construt the vec4 vertex position
    #pragma lines: attribute vec2 position;
    #pragma lines: position = getPosition(position);
    vec4 getPosition(vec2 position) {
      return vec4(position, 0, 1);
    }

    // Return the line width from a uniorm
    #pragma lines: width = getWidth();
    uniform float width;
    float getWidth() {
      return width;
    }

    // Specify a projection function
    #pragma lines: postproject = postprojectPosition;
    uniform mat4 projectionView;
    vec4 postprojectPosition(vec4 position) {
      return projectionView * position;
    }
  `,
  frag: `
    precision lowp float;
    void main () {
      gl_FragColor = vec4(1);
    }`,

  // Multiply the width by the pixel ratio for consistent width
  uniforms: {
    width: (ctx, props) => ctx.pixelRatio * props.width,
    projectionView: (ctx, props) => {
      //const aspect = ctx.viewportWidth / ctx.viewportHeight;
      const aspect = 2;
      const projection = mat4.perspective(mat4.create(), Math.PI / 4, aspect, 0.01, 10.0);
      const theta = ctx.time * 0.5;
      const r = 1.8;
      const eye = [
        r * Math.cos(theta),
        r * Math.sin(theta),
        0.5
      ];
      const center = [0, 0, 0];
      const up = [0, 0, 1];
      const view = mat4.lookAt(mat4.create(), eye, center, up);
      return mat4.multiply(projection, projection, view);
    }
  },
});

// Construct an array of xy pairs
const n = 501;
const position = [...Array(n + 3).keys()]
  .map(i => i / n * Math.PI * 2)
  .map(t => {
    const r = 0.6 + 0.4 * Math.cos(t * 7.0);
    return [r * Math.cos(t), r * Math.sin(t)]
  });

// Set up the data to be drawn. Note that we preallocate buffers and don't create
// them on every draw call.
const lineData = {
  width: 0.03,
  join: 'round',
  cap: 'round',
  vertexCount: position.length,
  vertexAttributes: { position: regl.buffer(position) },

  // Screen-project in the 1 x 1 unit square. Since this size is divided out before
  // post-projection, this only affects interpretation of "widthV.
  viewportSize: [1, 1]
};

regl.frame(() => {
  regl.clear({color: [0.2, 0.2, 0.2, 1]});
  drawLines(lineData);
});
