export function toRawUmbraAmount(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid Umbra amount: ${amount}`)
  }

  const [intPart = '0', fracPart = ''] = amount.split('.')
  const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(`${intPart}${paddedFrac}`)
}

export function toLamports(amount: string): bigint {
  return toRawUmbraAmount(amount, 9)
}
