/** Point-cloud shaders. Positions and visual state are interpolated on the GPU. */

export const vertexShader = /* glsl */ `
  // position holds the target; aFrom is where the transition started from.
  attribute vec3 aFrom;
  attribute vec3 aStateFrom;
  attribute vec3 aStateTo;
  attribute float aSeed;
  attribute float aSize;
  attribute float aGhost;

  uniform float uProgress;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uMotion;
  uniform float uBoost;
  uniform float uScan;
  uniform float uScanY;

  varying float vAlpha;
  varying float vHeat;
  varying float vHue;
  varying float vGhost;

  void main() {
    // Staggered start per particle so a transition reads as a flow, not a cut.
    float t = clamp(uProgress * 1.4 - aSeed * 0.4, 0.0, 1.0);
    float e = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);

    vec3 p = mix(aFrom, position, e);
    float mid = sin(e * 3.14159265);
    p += vec3(sin(aSeed * 40.0), cos(aSeed * 31.0), sin(aSeed * 17.0)) * mid * 0.3 * uMotion;

    vec3 state = mix(aStateFrom, aStateTo, e);
    float heat = state.y;

    // Ambient drift: the system is alive. Anomalous regions are visibly less stable.
    float phase = aSeed * 6.2831853;
    float amp = (0.016 + heat * 0.05) * uMotion;
    p += amp * vec3(sin(uTime * 0.6 + phase), cos(uTime * 0.5 + phase * 1.7), sin(uTime * 0.4 + phase * 2.3));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float scan = uScan * smoothstep(0.4, 0.0, abs(p.y - uScanY));
    gl_PointSize = aSize * 2.7 * uBoost * uScale * uPixelRatio * (1.0 + heat * 0.6 + scan * 0.9) * (11.0 / -mv.z);

    vAlpha = state.x * (1.0 + scan * 1.6);
    vHeat = heat;
    vHue = state.z;
    vGhost = aGhost;
  }
`;

export const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uCool;
  uniform vec3 uGhost;
  uniform vec3 uRisk;
  uniform vec3 uAttention;
  uniform vec3 uPositive;

  varying float vAlpha;
  varying float vHeat;
  varying float vHue;
  varying float vGhost;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5 || vAlpha < 0.004) discard;
    float core = smoothstep(0.5, 0.0, d);
    float ring = smoothstep(0.5, 0.42, d) * smoothstep(0.24, 0.42, d);
    float shape = mix(pow(core, 1.6), ring * 0.8 + core * 0.25, vGhost);

    vec3 hot = vHue < 0.5 ? mix(uRisk, uAttention, vHue * 2.0) : mix(uAttention, uPositive, vHue * 2.0 - 1.0);
    vec3 color = mix(mix(uCool, uGhost, vGhost), hot, vHeat);
    gl_FragColor = vec4(color, shape * vAlpha);
  }
`;
