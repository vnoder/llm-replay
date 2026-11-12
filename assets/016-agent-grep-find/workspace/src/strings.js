export function reverseString(s) {
  return s.split('').reverse().join('');
}

export function capitalizeWords(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
