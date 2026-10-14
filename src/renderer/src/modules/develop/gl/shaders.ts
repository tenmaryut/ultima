/**
 * GLSL ES 3.00 sources of the develop pipeline. Every function in COMMON / FINAL is the
 * twin of the function with the same name in ../color.ts or ../pipeline.ts (same
 * constants, same order of operations) — change both together.
 */

export const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 outColor;
`;

const COMMON = `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float luma(vec3 c) { return dot(c, LUMA); }
float srgbToLinear(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
vec3 srgbToLinear3(vec3 c) { return vec3(srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)); }
float linearToSrgb(float c) { if (c <= 0.0) return 0.0; return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
vec3 linearToSrgb3(vec3 c) { return vec3(linearToSrgb(c.r), linearToSrgb(c.g), linearToSrgb(c.b)); }
float toPerceptual(float y) { return pow(max(y, 0.0), 1.0 / 2.2); }
float fromPerceptual(float p) { return pow(max(p, 0.0), 2.2); }
`;

/* ------------------------------ Noise reduction ------------------------------ */

/** Separable joint filter: bilateral on luma + gaussian on chroma. Phase 0 = horizontal (rgb in), 1 = vertical (ycc in, blends with the original). */
export const NR = `${HEADER}${COMMON}
uniform sampler2D uTex;
uniform sampler2D uOrig;
uniform vec2 uDir;
uniform vec2 uSize;
uniform float uSigmaL;
uniform float uSigmaC;
uniform float uRange;
uniform int uRadius;
uniform int uPhase;
uniform float uAmtL;
uniform float uAmtC;

vec3 toYcc(vec3 c) { float y = luma(c); return vec3(y, (c.b - y) * 0.5389, (c.r - y) * 0.635); }
vec3 fromYcc(vec3 v) {
  float r = v.x + v.z / 0.635;
  float b = v.x + v.y / 0.5389;
  float g = (v.x - 0.2126 * r - 0.0722 * b) / 0.7152;
  return vec3(r, g, b);
}
vec3 fetchYcc(vec2 uv) {
  vec3 s = texture(uTex, uv).rgb;
  return uPhase == 0 ? toYcc(s) : vec3(s.x, s.yz - 0.5);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 center = fetchYcc(uv);
  float sumY = 0.0;
  float wY = 0.0;
  vec2 sumC = vec2(0.0);
  float wC = 0.0;
  for (int i = -uRadius; i <= uRadius; i++) {
    float fi = float(i);
    vec3 v = fetchYcc(uv + uDir * fi);
    if (uSigmaL > 0.0) {
      float dy = v.x - center.x;
      float w = exp(-fi * fi / (2.0 * uSigmaL * uSigmaL)) * exp(-dy * dy / (2.0 * uRange * uRange));
      sumY += v.x * w;
      wY += w;
    }
    if (uSigmaC > 0.0) {
      float w = exp(-fi * fi / (2.0 * uSigmaC * uSigmaC));
      sumC += v.yz * w;
      wC += w;
    }
  }
  vec3 res = center;
  if (wY > 0.0) res.x = sumY / wY;
  if (wC > 0.0) res.yz = sumC / wC;
  if (uPhase == 0) {
    outColor = vec4(res.x, res.yz + 0.5, 1.0);
    return;
  }
  vec3 orig = toYcc(texture(uOrig, uv).rgb);
  vec3 mixed = vec3(mix(orig.x, res.x, uAmtL), mix(orig.yz, res.yz, uAmtC));
  outColor = vec4(clamp(fromYcc(mixed), 0.0, 1.0), 1.0);
}`;

/* -------------------------------- Sharpening -------------------------------- */

export const SHARPEN_H = `${HEADER}${COMMON}
uniform sampler2D uTex;
uniform vec2 uDir;
uniform vec2 uSize;
uniform float uSigma;
uniform int uRadius;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float s = 0.0;
  float w = 0.0;
  for (int i = -uRadius; i <= uRadius; i++) {
    float fi = float(i);
    float wi = exp(-fi * fi / (2.0 * uSigma * uSigma));
    s += luma(texture(uTex, uv + uDir * fi).rgb) * wi;
    w += wi;
  }
  outColor = vec4(s / w, 0.0, 0.0, 1.0);
}`;

export const SHARPEN_V = `${HEADER}${COMMON}
uniform sampler2D uBlurH;
uniform sampler2D uBase;
uniform vec2 uDir;
uniform vec2 uSize;
uniform float uSigma;
uniform int uRadius;
uniform float uAmount;
uniform float uDetail;
uniform float uMasking;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float s = 0.0;
  float w = 0.0;
  for (int i = -uRadius; i <= uRadius; i++) {
    float fi = float(i);
    float wi = exp(-fi * fi / (2.0 * uSigma * uSigma));
    s += texture(uBlurH, uv + uDir * fi).r * wi;
    w += wi;
  }
  float blur = s / w;
  vec3 c = texture(uBase, uv).rgb;
  float delta = luma(c) - blur;
  float keep = mix(smoothstep(0.0, 0.03, abs(delta)), 1.0, uDetail);
  float d = delta * keep;
  d = d / (1.0 + abs(d) * 4.0);
  float mask = 1.0;
  if (uMasking > 0.0) {
    vec2 px = 1.0 / uSize;
    float gx = luma(texture(uBase, uv + vec2(px.x, 0.0)).rgb) - luma(texture(uBase, uv - vec2(px.x, 0.0)).rgb);
    float gy = luma(texture(uBase, uv + vec2(0.0, px.y)).rgb) - luma(texture(uBase, uv - vec2(0.0, px.y)).rgb);
    float g = length(vec2(gx, gy));
    mask = smoothstep(uMasking * 0.04, uMasking * 0.04 + 0.04, g);
  }
  outColor = vec4(clamp(c + uAmount * d * mask, 0.0, 1.0), 1.0);
}`;

/* ---------------------------- Luminance / blurs ----------------------------- */

/** r = encoded luminance, g = dark channel (min rgb). */
export const LUM = `${HEADER}${COMMON}
uniform sampler2D uTex;
uniform vec2 uSize;
void main() {
  vec3 c = texture(uTex, gl_FragCoord.xy / uSize).rgb;
  outColor = vec4(luma(c), min(c.r, min(c.g, c.b)), 0.0, 1.0);
}`;

/** Separable gaussian on the rg channels; samples the input at mip level uLod (downsampling). */
export const BLUR = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uDir;
uniform vec2 uSize;
uniform float uSigma;
uniform int uRadius;
uniform float uLod;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 s = vec2(0.0);
  float w = 0.0;
  for (int i = -uRadius; i <= uRadius; i++) {
    float fi = float(i);
    float wi = exp(-fi * fi / (2.0 * uSigma * uSigma));
    s += textureLod(uTex, uv + uDir * fi, uLod).rg * wi;
    w += wi;
  }
  outColor = vec4(s / w, 0.0, 1.0);
}`;

/* -------------------------------- Final pass -------------------------------- */

export const FINAL = `${HEADER}${COMMON}
uniform sampler2D uBase;
uniform sampler2D uOrig;
uniform sampler2D uLum;
uniform sampler2D uTexBlur;
uniform sampler2D uLowBlur;
uniform sampler2D uLut;
uniform mat3 uMap;
uniform vec2 uTarget;
uniform bool uFlipY;
uniform vec4 uOutMap;
uniform vec2 uOutFull;
uniform bool uHasTexBlur;
uniform bool uHasLow;
uniform mat3 uWb;
uniform float uExpGain;
uniform float uDehaze;
uniform vec3 uAtmos;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uClarity;
uniform float uTexture;
uniform float uVibrance;
uniform float uSaturation;
uniform bool uBw;
uniform bool uHslOn;
uniform float uHslH[8];
uniform float uHslS[8];
uniform float uHslL[8];
uniform bool uCurveOn;
uniform bool uGradeOn;
uniform vec4 uGradeS;
uniform vec4 uGradeM;
uniform vec4 uGradeH;
uniform vec4 uGradeG;
uniform float uGradeExp;
uniform float uGradeBal;
uniform vec4 uVig;
uniform vec3 uGrain;
uniform bool uEffects;
uniform float uSplit;
uniform bool uClip;
uniform bool uFillOutside;
uniform bool uDither;

const int LUT_SIZE = 1024;
const float CENTERS[9] = float[9](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0, 360.0);

vec3 dehazePixel(vec3 lin, float darkLin, float amount, vec3 atmos) {
  if (amount > 0.0) {
    float al = max(luma(atmos), 0.05);
    float t = max(1.0 - 0.95 * amount * (darkLin / al), 0.12);
    return max((lin - atmos) / t + atmos, 0.0);
  }
  if (amount < 0.0) return mix(lin, atmos, -amount * 0.65);
  return lin;
}

float localToneStops(float pBase, float shadows, float highlights) {
  float mS = 1.0 - smoothstep(0.05, 0.6, pBase);
  float mH = smoothstep(0.35, 0.95, pBase);
  return shadows * (shadows > 0.0 ? 1.4 : 1.0) * mS + highlights * (highlights < 0.0 ? 1.6 : 0.8) * mH;
}

float contrastCurve(float x, float c) {
  if (c == 0.0) return x;
  float g = exp2(c * 0.9);
  float m = 0.46;
  float xc = clamp(x, 0.0, 1.0);
  float y = xc <= m ? m * pow(xc / m, g) : 1.0 - (1.0 - m) * pow((1.0 - xc) / (1.0 - m), g);
  return y + max(x - 1.0, 0.0);
}

float globalTone(float p, float contrast, float whites, float blacks) {
  float v = contrastCurve(p, contrast);
  v += 0.22 * whites * smoothstep(0.35, 1.0, v);
  v += 0.12 * blacks * (1.0 - smoothstep(0.0, 0.45, v));
  return v;
}

float detailBoost(float p, float clarityDetail, float textureDetail, float clarity, float texture_) {
  float t = clamp(abs(2.0 * p - 1.0), 0.0, 1.0);
  float mid = 1.0 - t * t;
  float kc = clarity > 0.0 ? 1.6 * clarity : 0.9 * clarity;
  float kt = texture_ > 0.0 ? 2.2 * texture_ : 0.9 * texture_;
  return p + kc * clarityDetail * mid + kt * textureDetail * (0.4 + 0.6 * mid);
}

vec3 applyLuminance(vec3 c, float y, float yNew) {
  float ratio = yNew / max(y, 1e-5);
  float fill = yNew - y * ratio;
  return c * ratio + fill;
}

vec3 fitGamut(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  if (mx <= 1.0 && mn >= 0.0) return c;
  float y = clamp(luma(c), 0.0, 1.0);
  float k = 1.0;
  if (mx > 1.0) k = min(k, (1.0 - y) / max(mx - y, 1e-6));
  if (mn < 0.0) k = min(k, y / max(y - mn, 1e-6));
  k = clamp(k, 0.0, 1.0);
  return clamp(y + (c - y) * k, 0.0, 1.0);
}

float lutSample(int channel, float x) {
  float fx = clamp(x, 0.0, 1.0) * float(LUT_SIZE - 1);
  int i0 = int(floor(fx));
  int i1 = min(i0 + 1, LUT_SIZE - 1);
  float t = fx - float(i0);
  float a = texelFetch(uLut, ivec2(i0, 0), 0)[channel];
  float b = texelFetch(uLut, ivec2(i1, 0), 0)[channel];
  return a + (b - a) * t;
}

vec3 rgbToHsv(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  float h = 0.0;
  if (d > 1e-6) {
    if (mx == c.r) h = (c.g - c.b) / d;
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h *= 60.0;
    if (h < 0.0) h += 360.0;
  }
  return vec3(h, mx > 1e-6 ? d / mx : 0.0, mx);
}

vec3 hsvToRgb(float h, float s, float v) {
  float hh = mod(mod(h, 360.0) + 360.0, 360.0) / 60.0;
  vec3 k = mod(vec3(5.0, 3.0, 1.0) + hh, 6.0);
  return v - v * s * max(vec3(0.0), min(min(k, 4.0 - k), vec3(1.0)));
}

void bandSegment(float hue, out int i, out int j, out float w) {
  float h = mod(mod(hue, 360.0) + 360.0, 360.0);
  i = 7;
  for (int k = 0; k < 8; k++) {
    if (h >= CENTERS[k] && h < CENTERS[k + 1]) { i = k; break; }
  }
  float t = (h - CENTERS[i]) / (CENTERS[i + 1] - CENTERS[i]);
  float c = cos(1.5707963267948966 * t);
  w = c * c;
  j = (i + 1) % 8;
}

vec3 applyHsl(vec3 enc, bool bw) {
  vec3 c = enc;
  if (uHslOn) {
    vec3 hsv = rgbToHsv(c);
    int i; int j; float w;
    bandSegment(hsv.x, i, j, w);
    float satW = smoothstep(0.02, 0.2, hsv.y);
    if (!bw) {
      float h = hsv.x + (uHslH[i] * w + uHslH[j] * (1.0 - w)) * 30.0;
      float sat = clamp(hsv.y * (1.0 + uHslS[i] * w + uHslS[j] * (1.0 - w)), 0.0, 1.0);
      c = hsvToRgb(h, sat, hsv.z);
    }
    float stops = (uHslL[i] * w + uHslL[j] * (1.0 - w)) * (bw ? 1.6 : 1.2) * satW;
    if (stops != 0.0) c = fitGamut(linearToSrgb3(srgbToLinear3(c) * exp2(stops)));
  }
  if (bw) {
    float g = linearToSrgb(luma(srgbToLinear3(c)));
    c = vec3(g);
  }
  return c;
}

vec3 vibranceSaturation(vec3 enc, float vibrance, float saturation) {
  if (vibrance == 0.0 && saturation == 0.0) return enc;
  float y = luma(enc);
  float mx = max(enc.r, max(enc.g, enc.b));
  float mn = min(enc.r, min(enc.g, enc.b));
  float s = mx - mn;
  float hue = rgbToHsv(enc).x;
  float dist = abs(mod(hue - 25.0 + 540.0, 360.0) - 180.0);
  float skin = 1.0 - 0.6 * (1.0 - smoothstep(0.0, 35.0, dist));
  float inv = 1.0 - s;
  float vf = vibrance >= 0.0 ? 1.0 + vibrance * inv * inv * skin * 1.2 : 1.0 + vibrance * (1.0 - s * 0.5);
  float k = vf * (1.0 + saturation);
  return fitGamut(y + (enc - y) * k);
}

vec3 gradeWeights(float l) {
  float lb = pow(clamp(l, 0.0, 1.0), uGradeBal);
  float ws = pow(1.0 - lb, uGradeExp);
  float wh = pow(lb, uGradeExp);
  return vec3(ws, max(0.0, 1.0 - ws - wh), wh);
}

vec3 applyGrading(vec3 enc) {
  vec3 w = gradeWeights(luma(enc));
  vec3 off = w.x * uGradeS.rgb + w.y * uGradeM.rgb + w.z * uGradeH.rgb + uGradeG.rgb;
  float lum = w.x * uGradeS.a + w.y * uGradeM.a + w.z * uGradeH.a + uGradeG.a;
  return fitGamut(enc + off + lum);
}

float vignetteMask(float nx, float ny, float aspect, float midpoint, float roundness, float feather) {
  float x = nx * 2.0 - 1.0;
  float y = ny * 2.0 - 1.0;
  float r = max(roundness, 0.0);
  float qx = mix(1.0, min(aspect, 1.0), r);
  float qy = mix(1.0, min(1.0 / aspect, 1.0), r);
  float vx = abs(x * qx);
  float vy = abs(y * qy);
  float n = roundness < 0.0 ? 2.0 - roundness * 6.0 : 2.0;
  float d = pow(pow(vx, n) + pow(vy, n), 1.0 / n);
  float rc = mix(0.3, 1.3, midpoint);
  float width = mix(0.05, 1.1, feather);
  return smoothstep(rc - width / 2.0, rc + width / 2.0, d);
}

vec3 applyVignette(vec3 enc, float mask, float amount) {
  if (amount < 0.0) return enc * (1.0 + amount * mask);
  return enc + (1.0 - enc) * amount * mask;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

vec3 applyGrain(vec3 enc, vec2 full) {
  float cell = mix(1.0, 4.5, uGrain.y) * max(1.0, max(uOutFull.x, uOutFull.y) / 4000.0);
  vec2 q = full / cell;
  float n1 = valueNoise(q);
  float n2 = valueNoise(q * 2.13 + 17.3);
  float n = mix(n1, n1 * 0.55 + n2 * 0.45, uGrain.z) * (1.0 + 0.6 * uGrain.z);
  float l = luma(enc);
  float w = 0.35 + 2.6 * l * (1.0 - l);
  return clamp(enc + n * uGrain.x * 0.16 * w, 0.0, 1.0);
}

/* processPixel() in pipeline.ts */
vec3 developPixel(vec2 uv, vec2 n) {
  vec3 src = texture(uBase, uv).rgb;
  vec2 lumv = texture(uLum, uv).rg;
  float lumEnc = lumv.r;
  float clarityBlur = lumEnc;
  float darkBlur = lumv.g;
  float textureBlur = lumEnc;
  if (uHasLow) {
    vec2 lb = texture(uLowBlur, uv).rg;
    clarityBlur = lb.r;
    darkBlur = lb.g;
  }
  if (uHasTexBlur) textureBlur = texture(uTexBlur, uv).r;

  vec3 lin = srgbToLinear3(src);
  if (uDehaze != 0.0) lin = dehazePixel(lin, srgbToLinear(darkBlur), uDehaze, uAtmos);
  lin = uWb * lin;
  lin *= uExpGain;
  if (uShadows != 0.0 || uHighlights != 0.0) {
    float y0 = luma(lin);
    float yb = srgbToLinear(clarityBlur) * uExpGain;
    float stops = localToneStops(toPerceptual(mix(y0, yb, 0.6)), uShadows, uHighlights);
    lin *= exp2(stops);
  }
  float y = luma(lin);
  float p = toPerceptual(y);
  float p2 = detailBoost(globalTone(p, uContrast, uWhites, uBlacks), lumEnc - clarityBlur, lumEnc - textureBlur, uClarity, uTexture);
  if (p2 != p) lin = applyLuminance(lin, y, fromPerceptual(p2));
  lin = fitGamut(lin);

  vec3 enc = linearToSrgb3(lin);
  if (uCurveOn) {
    enc = vec3(lutSample(0, lutSample(3, enc.r)), lutSample(1, lutSample(3, enc.g)), lutSample(2, lutSample(3, enc.b)));
  }
  enc = applyHsl(enc, uBw);
  if (!uBw) enc = vibranceSaturation(enc, uVibrance, uSaturation);
  if (uGradeOn) enc = applyGrading(enc);
  if (uEffects && uVig.x != 0.0) enc = applyVignette(enc, vignetteMask(n.x, n.y, uOutFull.x / uOutFull.y, uVig.y, uVig.z, uVig.w), uVig.x);
  return clamp(enc, 0.0, 1.0);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uFlipY ? uTarget.y - gl_FragCoord.y : gl_FragCoord.y);
  vec2 uv = (uMap * vec3(p, 1.0)).xy;
  vec2 full = uOutMap.xy + p * uOutMap.zw;
  vec2 n = full / uOutFull;
  if (uFillOutside && (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0)) {
    outColor = vec4(0.0);
    return;
  }
  vec3 color;
  if (uSplit > 0.0 && n.x < uSplit) {
    color = texture(uOrig, uv).rgb;
  } else {
    color = developPixel(uv, n);
    if (uEffects && uGrain.x > 0.0) color = applyGrain(color, full);
  }
  if (uClip) {
    if (min(color.r, min(color.g, color.b)) >= 0.996) color = vec3(1.0, 0.15, 0.15);
    else if (max(color.r, max(color.g, color.b)) <= 0.004) color = vec3(0.15, 0.4, 1.0);
  }
  if (uDither) color += (hash12(gl_FragCoord.xy + 0.37) - 0.5) / 255.0;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;
