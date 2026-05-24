// lib/supabase.js
// ─────────────────────────────────────────────────────────────
//  Substitua as duas constantes abaixo pelas suas credenciais:
//  Supabase → Settings → API → Project URL e anon public key
// ─────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = 'https://wyryyxoymihwgjmqjidf.supabase.co';  // ← troque
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5cnl5eG95bWlod2dqbXFqaWRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTk2OTQsImV4cCI6MjA5NTEzNTY5NH0.q5uV65G-FNRN47xS-AyG8W-xPBF3rzBIxi5i_8jB2X0';                   // ← troque

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);


// ─── HELPERS: Contas ──────────────────────────────────────────

export async function getContas() {
  const { data, error } = await supabase
    .from('contas')
    .select('*')
    .order('vencimento');
  if (error) throw error;
  return data.map(c => ({
    ...c,
    parcelaAtual:  c.parcela_atual,
    totalParcelas: c.total_parcelas,
    pagoMeses:     c.pago_meses || {},
  }));
}

export async function upsertConta(conta) {
  const { data, error } = await supabase
    .from('contas')
    .upsert({
      id:             conta.id,
      nome:           conta.nome,
      categoria:      conta.categoria,
      valor:          conta.valor,
      vencimento:     conta.vencimento,
      pago:           conta.pago,
      recorrente:     conta.recorrente,
      parcela_atual:  conta.parcelaAtual || null,
      total_parcelas: conta.totalParcelas || null,
      pago_meses:     conta.pagoMeses || {},
      obs:            conta.obs || "",
    }, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  // mapeia de volta snake_case → camelCase
  return {
    ...data,
    parcelaAtual:  data.parcela_atual,
    totalParcelas: data.total_parcelas,
    pagoMeses:     data.pago_meses || {},
  };
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
