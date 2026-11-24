const canvas = document.getElementById("glcanvas");
document.documentElement.style.cssText = "margin:0; height:100%; overflow:hidden;";
document.body.style.cssText = "margin:0; height:100%; overflow:hidden;";
canvas.style.cssText = "display:block; width:100vw; height:100vh;";

const gl = canvas.getContext("webgl2");

const ATTRIBUTES = { aPosition: 0, aNormal: 1, aTangent: 2, aTexCoord: 3 };
const SKY = [0.55, 0.70, 0.90];

const VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aTexCoord;

uniform mat4 uModelView;
uniform mat4 uProjection;

out vec3 vPosition;
out vec3 vNormal;
out vec2 vTexCoord;

void main() {
  vec4 viewPos = uModelView * vec4(aPosition, 1.0);
  vPosition = viewPos.xyz;
  vNormal = mat3(transpose(inverse(uModelView))) * aNormal;
  vTexCoord = aTexCoord;
  gl_Position = uProjection * viewPos;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vPosition;
in vec3 vNormal;
in vec2 vTexCoord;

uniform sampler2D uTexture;
uniform int uMapping;
uniform vec3 uSolidColor;
uniform vec3 uLightPos;
uniform vec3 uKa, uKd, uKs;
uniform float uShininess;
uniform vec3 uSkyColor;
uniform float uFogStart, uFogEnd;

out vec4 outColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightPos - vPosition);
  vec3 V = normalize(-vPosition);
  vec3 R = reflect(-L, N);

  vec3 base = uSolidColor;
  if (uMapping == 1) {
    vec3 rock = texture(uTexture, vTexCoord).rgb;
    float snow = smoothstep(0.65, 0.80, vTexCoord.y);
    base = mix(rock, vec3(0.95), snow);
  }

  vec3 ambient  = uKa * base;
  vec3 diffuse  = uKd * base * max(dot(N, L), 0.0);
  vec3 specular = uKs * pow(max(dot(R, V), 0.0), uShininess);
  vec3 lit = ambient + diffuse + specular;

  float fog = smoothstep(uFogStart, uFogEnd, length(vPosition));
  outColor = vec4(mix(lit, uSkyColor, fog), 1.0);
}
`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function createProgram(vsSource, fsSource) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
  for (const name in ATTRIBUTES) gl.bindAttribLocation(prog, ATTRIBUTES[name], name);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

let program;
const U = {};
const UNIFORM_NAMES = ["uModelView", "uProjection", "uLightPos", "uMapping", "uTexture",
  "uSolidColor", "uKa", "uKd", "uKs", "uShininess", "uSkyColor", "uFogStart", "uFogEnd"];

function updateProgram() {
  try {
    const prog = createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    if (program) gl.deleteProgram(program);
    program = prog;
    gl.useProgram(program);
    for (const n of UNIFORM_NAMES) U[n] = gl.getUniformLocation(program, n);
    gl.uniform1i(U.uTexture, 0);
  } catch (e) {
    console.error(e.message);
  }
}
updateProgram();


function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
}
function lookAt(e, c, up) {
  let z = [e[0]-c[0], e[1]-c[1], e[2]-c[2]];
  let l = Math.hypot(...z); z = z.map(v => v / l);
  let x = [up[1]*z[2]-up[2]*z[1], up[2]*z[0]-up[0]*z[2], up[0]*z[1]-up[1]*z[0]];
  l = Math.hypot(...x); x = x.map(v => v / l);
  const y = [z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]];
  return new Float32Array([
    x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
    -(x[0]*e[0]+x[1]*e[1]+x[2]*e[2]),
    -(y[0]*e[0]+y[1]*e[1]+y[2]*e[2]),
    -(z[0]*e[0]+z[1]*e[1]+z[2]*e[2]), 1]);
}

function modelMatrix(tx, ty, tz, sx, sy, sz, rotY) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return new Float32Array([
    c*sx,0,-s*sx,0,  0,sy,0,0,  s*sz,0,c*sz,0,  tx,ty,tz,1]);
}
function transformPoint(m, p) {
  return [
    m[0]*p[0] + m[4]*p[1] + m[8]*p[2]  + m[12],
    m[1]*p[0] + m[5]*p[1] + m[9]*p[2]  + m[13],
    m[2]*p[0] + m[6]*p[1] + m[10]*p[2] + m[14]];
}


function hash(i, j, seed) {
  const x = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

function createCone(segments = 64, uRepeat = 3, radius = 1, height = 1,
                    rings = 16, jag = 0.3, seed = 1) {
  const positions = [], normals = [], tangents = [], texCoords = [], indices = [];
  const yBase = -height / 2;

  // Vertex position at ring i (0 = base, rings = apex), segment j
  function P(i, j) {
    i = Math.max(0, Math.min(rings, i));
    j = ((j % segments) + segments) % segments;        // wrap so the seam matches
    const t = i / rings;
    const theta = (j / segments) * Math.PI * 2;
    let r = radius * Math.pow(1 - t, 1.25);            // slightly concave slope
    r *= 1 + 0.2 * Math.sin(3 * theta + seed)          // lumpy outline
           + (hash(i, j, seed) - 0.5) * jag * (1 - t); // jagged noise, fades toward the top
    const y = yBase + height * t + (hash(i + 50, j, seed) - 0.5) * 0.05 * height * (1 - t);
    return [r * Math.sin(theta), y, r * Math.cos(theta)];
  }

  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= segments; j++) {        // <= duplicates the seam vertex (u = 0 and u = uRepeat)
      const p = P(i, j);
      const a = P(i, j + 1), b = P(i, j - 1);    // neighbors around the mountain
      const c = P(i + 1, j), d = P(i - 1, j);    // neighbors up/down the slope
      const du = [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
      const dv = [c[0]-d[0], c[1]-d[1], c[2]-d[2]];

      let n = [du[1]*dv[2]-du[2]*dv[1], du[2]*dv[0]-du[0]*dv[2], du[0]*dv[1]-du[1]*dv[0]];
      const nl = Math.hypot(...n);
      n = nl < 1e-6 ? [0, 1, 0] : n.map(v => v / nl);          // apex: point straight up
      const tl = Math.hypot(...du);
      const tan = tl < 1e-6 ? [1, 0, 0] : du.map(v => v / tl);

      positions.push(...p);
      normals.push(...n);
      tangents.push(...tan);
      texCoords.push((j / segments) * uRepeat, i / rings);
    }
  }

  const stride = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * stride + j, b = a + 1, c = a + stride, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    tangents: new Float32Array(tangents),
    texCoords: new Float32Array(texCoords),
    indices: new Uint16Array(indices)
  };
}

function createGround() {
  const s = 600;
  return {
    positions: new Float32Array([-s,0,60,  s,0,60,  s,0,-500,  -s,0,-500]),
    normals:   new Float32Array([0,1,0, 0,1,0, 0,1,0, 0,1,0]),
    tangents:  new Float32Array([1,0,0, 1,0,0, 1,0,0, 1,0,0]),
    texCoords: new Float32Array([0,0, 1,0, 1,1, 0,1]),
    indices:   new Uint16Array([0,1,2, 0,2,3])
  };
}

function bindAttribute(name, data, size) {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.vertexAttribPointer(ATTRIBUTES[name], size, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(ATTRIBUTES[name]);
}

function createMesh({ positions, normals, tangents, texCoords, indices }) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  bindAttribute("aPosition", positions, 3);
  bindAttribute("aNormal", normals, 3);
  bindAttribute("aTangent", tangents, 3);
  bindAttribute("aTexCoord", texCoords, 2);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  return { vao, count: indices.length };
}

// Two mountain shapes (different seeds) so they don't all look identical
const mountainMeshes = [
  createMesh(createCone(64, 3, 1, 1, 16, 0.3, 1.0)),
  createMesh(createCone(64, 3, 1, 1, 16, 0.3, 7.3)),
];
const groundMesh = createMesh(createGround());

// ---------- Texture ----------
const tex = gl.createTexture();
function uploadTexture(source) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
}
// Procedural fallback so you see rock even before your image loads
(function () {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#6b6258"; g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 6000; k++) {
    const v = 70 + Math.random() * 70;
    g.fillStyle = `rgba(${v},${v * 0.95},${v * 0.88},0.5)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 6, 1 + Math.random() * 3);
  }
  uploadTexture(c);
})();
// Your real texture (serve with a local server, e.g. python3 -m http.server)
const img = new Image();
img.onload = () => uploadTexture(img);
img.src = "rock_mountain.jfif";

// ---------- Scene ----------
const EYE = [0, 5, 20];
const TARGET = [0, 18, -100];
const LIGHT_WORLD = [150, 250, 50];

// r = base radius, h = height, rot = spin around Y (hides repeated shapes)
const MOUNTAINS = [
  { x: -90, z: -110, r: 45, h: 38, rot: 0.3, mesh: 0 },
  { x: -40, z: -130, r: 55, h: 55, rot: 1.1, mesh: 1 },
  { x:  10, z: -100, r: 40, h: 34, rot: 2.0, mesh: 0 },
  { x:  55, z: -135, r: 60, h: 60, rot: 0.7, mesh: 1 },
  { x: 100, z: -105, r: 42, h: 36, rot: 2.6, mesh: 0 },
  { x: -20, z: -170, r: 80, h: 70, rot: 1.8, mesh: 1 },
  { x: 130, z: -160, r: 70, h: 50, rot: 0.2, mesh: 0 },
];
const BASE_Y = -2;   // sink the bases slightly below the ground so no gap shows

// ---------- Resize ----------
let aspect = 1;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    aspect = w / h;
  }
}
window.addEventListener("resize", resize);
resize();

// ---------- Render ----------
function drawMesh(mesh, model, view) {
  gl.uniformMatrix4fv(U.uModelView, false, mul(view, model));
  gl.bindVertexArray(mesh.vao);
  gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
}

function render() {
  resize();
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(SKY[0], SKY[1], SKY[2], 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const view = lookAt(EYE, TARGET, [0, 1, 0]);
  const proj = perspective(Math.PI / 3, aspect, 0.1, 600);

  gl.uniformMatrix4fv(U.uProjection, false, proj);
  gl.uniform3fv(U.uLightPos, transformPoint(view, LIGHT_WORLD));  // light into view space
  gl.uniform3fv(U.uSkyColor, SKY);
  gl.uniform1f(U.uFogStart, 60);
  gl.uniform1f(U.uFogEnd, 300);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);

  // Ground: flat green, almost no specular
  gl.uniform1i(U.uMapping, 0);
  gl.uniform3fv(U.uSolidColor, [0.30, 0.45, 0.25]);
  gl.uniform3fv(U.uKa, [0.30, 0.30, 0.30]);
  gl.uniform3fv(U.uKd, [0.65, 0.65, 0.65]);
  gl.uniform3fv(U.uKs, [0.02, 0.02, 0.02]);
  gl.uniform1f(U.uShininess, 4.0);
  drawMesh(groundMesh, modelMatrix(0, 0, 0, 1, 1, 1, 0), view);

  // Mountains: textured, matte rock
  gl.uniform1i(U.uMapping, 1);
  gl.uniform3fv(U.uKa, [0.35, 0.35, 0.38]);
  gl.uniform3fv(U.uKd, [0.75, 0.72, 0.70]);
  gl.uniform3fv(U.uKs, [0.05, 0.05, 0.05]);
  gl.uniform1f(U.uShininess, 8.0);
  for (const m of MOUNTAINS) {
    // unit cone is centered on y = 0, so lift it by h/2 to put its base at BASE_Y
    const model = modelMatrix(m.x, BASE_Y + m.h / 2, m.z, m.r, m.h, m.r, m.rot);
    drawMesh(mountainMeshes[m.mesh], model, view);
  }

  requestAnimationFrame(render);
}
requestAnimationFrame(render);