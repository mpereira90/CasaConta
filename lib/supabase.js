// lib/supabase.js
// ─────────────────────────────────────────────────────────────
//  Substitua as duas constantes abaixo pelas suas credenciais:
//  Supabase → Settings → API → Project URL e anon public key
// ─────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = 'https://opxbmgwizkgifcztnmcq.supabase.co';  // ← troque
const SUPABASE_ANON = 'sb_publishable_PnGTt_zclafp66_thaGEsw_i3pfTBRe';                   // ← troque

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);


// ─── HELPERS: Contas ──────────────────────────────────────────

export async function getContas() {
  const { data, error } = await supabase
    .from('contas')
    .select('*')
    .order('vencimento');
  if (error) throw error;
  return data;
}

export async function upsertConta(conta) {
  // converte campos do app (camelCase) → banco (snake_case é igual aqui)
  const { data, error } = await supabase
    .from('contas')
    .upsert(conta, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteConta(id) {
  const { error } = await supabase.from('contas').delete().eq('id', id);
  if (error) throw error;
}

export async function toggleContaPago(id, pago) {
  const { error } = await supabase
    .from('contas')
    .update({ pago })
    .eq('id', id);
  if (error) throw error;
}


// ─── HELPERS: Cartões ─────────────────────────────────────────

export async function getCartoes() {
  const { data, error } = await supabase
    .from('cartoes')
    .select('*')
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function upsertCartao(cartao) {
  const { data, error } = await supabase
    .from('cartoes')
    .upsert(cartao, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCartao(id) {
  // compras e faturas_pagas são deletadas em cascata pelo banco
  const { error } = await supabase.from('cartoes').delete().eq('id', id);
  if (error) throw error;
}


// ─── HELPERS: Faturas pagas ───────────────────────────────────

export async function getFaturasPagas() {
  const { data, error } = await supabase
    .from('faturas_pagas')
    .select('*');
  if (error) throw error;
  // retorna como objeto { "cartaoId_mes": true } para compatibilidade com o app
  return data.reduce((acc, row) => {
    acc[`${row.cartao_id}_${row.mes}`] = row.pago;
    return acc;
  }, {});
}

export async function toggleFaturaPaga(cartaoId, mes, pago) {
  const { error } = await supabase
    .from('faturas_pagas')
    .upsert({ cartao_id: cartaoId, mes, pago }, { onConflict: 'cartao_id,mes' });
  if (error) throw error;
}


// ─── HELPERS: Compras ─────────────────────────────────────────

export async function getCompras() {
  const { data, error } = await supabase
    .from('compras')
    .select('*')
    .order('created_at');
  if (error) throw error;
  // mapeia snake_case do banco → camelCase do app
  return data.map(mapCompraFromDB);
}

export async function upsertCompra(compra) {
  const { data, error } = await supabase
    .from('compras')
    .upsert(mapCompraToDB(compra), { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return mapCompraFromDB(data);
}

export async function deleteCompra(id) {
  const { error } = await supabase.from('compras').delete().eq('id', id);
  if (error) throw error;
}

// snake_case ↔ camelCase para compras
function mapCompraToDB(c) {
  return {
    id:             c.id,
    cartao_id:      c.cartaoId,
    descricao:      c.descricao,
    valor:          c.valor,
    total_parcelas: c.totalParcelas,
    parcela_atual:  c.parcelaAtual,
    mes:            c.mes,
    obs:            c.obs,
  };
}

function mapCompraFromDB(c) {
  return {
    id:            c.id,
    cartaoId:      c.cartao_id,
    descricao:     c.descricao,
    valor:         c.valor,
    totalParcelas: c.total_parcelas,
    parcelaAtual:  c.parcela_atual,
    mes:           c.mes,
    obs:           c.obs,
  };
}


// ─── HELPERS: Empréstimos ─────────────────────────────────────

export async function getEmprestimos() {
  const { data, error } = await supabase
    .from('emprestimos')
    .select('*')
    .order('created_at');
  if (error) throw error;
  return data.map(e => ({
    ...e,
    valorTotal:   e.valor_total,
    valorParcela: e.valor_parcela,
    parcelaAtual: e.parcela_atual,
    totalParcelas:e.total_parcelas,
    pagoMeses:    e.pago_meses || {},
  }));
}

export async function upsertEmprestimo(e) {
  const { data, error } = await supabase
    .from('emprestimos')
    .upsert({
      id:             e.id,
      nome:           e.nome,
      banco:          e.banco || '',
      valor_total:    e.valorTotal,
      valor_parcela:  e.valorParcela,
      parcela_atual:  e.parcelaAtual,
      total_parcelas: e.totalParcelas,
      pago_meses:     e.pagoMeses || {},
      obs:            e.obs || '',
    }, { onConflict: 'id' })
    .select().single();
  if (error) throw error;
  return {
    ...data,
    valorTotal:   data.valor_total,
    valorParcela: data.valor_parcela,
    parcelaAtual: data.parcela_atual,
    totalParcelas:data.total_parcelas,
    pagoMeses:    data.pago_meses || {},
  };
}

export async function deleteEmprestimo(id) {
  const { error } = await supabase.from('emprestimos').delete().eq('id', id);
  if (error) throw error;
}


// ─── HELPERS: Entradas ────────────────────────────────────────

export async function getEntradas() {
  const { data, error } = await supabase
    .from('entradas')
    .select('*')
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function upsertEntrada(e) {
  const { data, error } = await supabase
    .from('entradas')
    .upsert({
      id:         e.id,
      descricao:  e.descricao,
      valor:      e.valor,
      mes:        e.mes,
      recorrente: e.recorrente || false,
      obs:        e.obs || '',
    }, { onConflict: 'id' })
    .select().single();
  if (error) throw error;
  return data;
}

export async function deleteEntrada(id) {
  const { error } = await supabase.from('entradas').delete().eq('id', id);
  if (error) throw error;
}
