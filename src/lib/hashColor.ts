export function hashToHue(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 0..359
  return Math.abs(h) % 360;
}

export function colorFromId(id: string) {
  const hue = hashToHue(id);
  return `hsl(${hue} 70% 55%)`;
}
