export function addressesEqual(left, right) {
  return Boolean(left && right) && left.toLowerCase() === right.toLowerCase();
}
