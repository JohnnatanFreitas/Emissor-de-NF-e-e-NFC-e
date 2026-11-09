import { describe, expect, it } from 'vitest'
import { brl, centavosParaTexto, chaveBR, cnpjBR, cnpjValido, cpfBR, cpfValido, dataBR, dataHoraBR, documentoBR,
  mascaraDocumento, pct, quantidade, somarDias, textoParaCentavos, textoParaNumero } from './formato'

describe('dinheiro em centavos', () => {
  it('brl formata centavos em reais', () => {
    expect(brl(123456)).toBe('R$ 1.234,56')
    expect(brl(0)).toBe('R$ 0,00')
    expect(brl(null)).toBe('—')
  })
  it('texto digitado vira centavos (vírgula ou ponto decimal, milhar com ponto)', () => {
    expect(textoParaCentavos('1.234,56')).toBe(123456)
    expect(textoParaCentavos('1234.5')).toBe(123450)
    expect(textoParaCentavos('R$ 10')).toBe(1000)
    expect(textoParaCentavos('1.000')).toBe(100000)
    expect(textoParaCentavos('0,1')).toBe(10)
    expect(textoParaCentavos('')).toBeNull()
    expect(textoParaCentavos('abc')).toBeNull()
  })
  it('ida e volta do campo editável', () => {
    expect(centavosParaTexto(99)).toBe('0,99')
    expect(textoParaCentavos(centavosParaTexto(1234567))).toBe(1234567)
  })
})

describe('números', () => {
  it('quantidade, alíquota e texto decimal', () => {
    expect(quantidade(1500.5)).toBe('1.500,5')
    expect(pct(0.1)).toBe('0,1%')
    expect(pct(18)).toBe('18%')
    expect(textoParaNumero('2,5')).toBe(2.5)
    expect(textoParaNumero('x')).toBeNull()
  })
})

describe('datas', () => {
  it('dataBR não muda o dia por fuso', () => {
    expect(dataBR('2026-11-08')).toBe('08/11/2026')
    expect(dataBR('2026-11-08T23:59:00-03:00')).toBe('08/11/2026')
    expect(dataBR(null)).toBe('—')
  })
  it('dataHoraBR em horário de Brasília', () => {
    expect(dataHoraBR('2026-11-08T17:03:00Z')).toBe('08/11/2026 14:03')
    expect(dataHoraBR('lixo')).toBe('—')
  })
  it('somarDias atravessa o mês', () => {
    expect(somarDias('2026-11-25', 30)).toBe('2026-12-25')
    expect(somarDias('2026-01-31', 1)).toBe('2026-02-01')
  })
})

describe('documentos', () => {
  it('formata CNPJ, CPF e chave de acesso', () => {
    expect(cnpjBR('11222333000181')).toBe('11.222.333/0001-81')
    expect(cpfBR('52998224725')).toBe('529.982.247-25')
    expect(documentoBR('52998224725')).toBe('529.982.247-25')
    expect(chaveBR('35261111222333000181550010000000011000000010')).toBe(
      '3526 1111 2223 3300 0181 5500 1000 0000 0110 0000 0010')
  })
  it('máscara progressiva', () => {
    expect(mascaraDocumento('529982')).toBe('529.982')
    expect(mascaraDocumento('11222333000181')).toBe('11.222.333/0001-81')
  })
  it('dígitos verificadores', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
    expect(cnpjValido('11.222.333/0001-82')).toBe(false)
    expect(cnpjValido('00000000000000')).toBe(false)
    expect(cpfValido('529.982.247-25')).toBe(true)
    expect(cpfValido('529.982.247-24')).toBe(false)
  })
})
