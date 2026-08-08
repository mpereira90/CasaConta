import { useState, useEffect } from "react";
import {
  getContas, upsertConta, deleteConta as dbDeleteConta, toggleContaPago,
  getCartoes, upsertCartao, deleteCartao as dbDeleteCartao,
  getCompras, upsertCompra, deleteCompra as dbDeleteCompra,
  getFaturasPagas, toggleFaturaPaga,
} from '../lib/supabase';

// ─── UTILS ───────────────────────────────────────────────────
const fmtBRL = (v) => Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const fmtDate = (s) => { if(!s) return "-"; const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; };
const uid = () => crypto.randomUUID();
const mesAtualStr = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const hoje0 = () => { const d=new Date(); d.setHours(0,0,0,0); return d; };
const daysUntil = (s) => Math.round((new Date(s+"T00:00:00")-hoje0())/864e5);
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function addMeses(mesStr, n) {
  const [y, m] = mesStr.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

// ─── CATEGORIAS ──────────────────────────────────────────────
const CATS = [
  {id:"moradia",   label:"Moradia",        icon:"🏠"},
  {id:"energia",   label:"Luz / Energia",  icon:"⚡"},
  {id:"agua",      label:"Água",           icon:"💧"},
  {id:"internet",  label:"Internet",       icon:"📡"},
  {id:"celular",   label:"Celular",        icon:"📱"},
  {id:"carro",     label:"Carro",          icon:"🚗"},
  {id:"saude",     label:"Saúde",          icon:"❤️"},
  {id:"educacao",  label:"Educação",       icon:"📚"},
  {id:"financ",    label:"Financiamento",  icon:"🏦"},
  {id:"outros",    label:"Outros",         icon:"📌"},
];

const BANDEIRAS = [
  {id:"nubank",      label:"Nubank",        cor:"#820ad1", icon:"💜"},
  {id:"visa",        label:"Visa",          cor:"#1a1f71", icon:"💙"},
  {id:"mastercard",  label:"Mastercard",    cor:"#eb001b", icon:"🔴"},
  {id:"elo",         label:"Elo",           cor:"#f6a600", icon:"🟡"},
  {id:"amex",        label:"Amex",          cor:"#007bc1", icon:"🔵"},
  {id:"hipercard",   label:"Hipercard",     cor:"#b22222", icon:"❤️"},
  {id:"outro",       label:"Outro",         cor:"#64748b", icon:"💳"},
];

const ST = {
  pago:     {label:"Pago",     cor:"#059669", bg:"#d1fae5"},
  pendente: {label:"Pendente", cor:"#d97706", bg:"#fef3c7"},
  vencido:  {label:"Vencido",  cor:"#dc2626", bg:"#fee2e2"},
};

const EMPTY_CONTA  = {nome:"",categoria:"moradia",valor:"",vencimento:"",pago:false,recorrente:false,parcelaAtual:"",totalParcelas:"",obs:""};
const EMPTY_CARTAO = {nome:"",bandeira:"nubank",limite:"",obs:""};
const EMPTY_COMPRA = {cartaoId:"",descricao:"",valor:"",totalParcelas:"1",mes:"",obs:"",recorrente:false};

// ─── LÓGICA DE RECORRÊNCIA E ATRASO ──────────────────────────
function expandirContasParaMes(contas, filtroMes) {
  const linhas = [];

  for (const c of contas) {
    if (!c.vencimento) continue;
    const mb = c.vencimento.substring(0, 7);
    const dia = c.vencimento.substring(8, 10);
    const totalParcelas = c.totalParcelas ? Number(c.totalParcelas) : 0;
    const pagoMeses = c.pagoMeses || {};

    // ── Conta simples (não recorrente, sem parcelas) ──
    if (!c.recorrente && totalParcelas === 0) {
      if (mb === filtroMes) {
        linhas.push({...c, _mesOrigem: mb, status: undefined});
      } else if (mb < filtroMes && !c.pago) {
        linhas.push({
          ...c,
          vencimento: `${filtroMes}-${dia}`,
          _mesOrigem: mb,
          _atrasada: true,
          _mesFiltro: mb,
          _labelAtraso: `Atrasada desde ${MESES[Number(mb.split("-")[1])-1]}/${mb.split("-")[0]}`,
        });
      }
      continue;
    }

    // ── Recorrente eterna (sem parcelas definidas) ──
    if (c.recorrente && totalParcelas === 0) {
      if (filtroMes < mb) continue;

      // Meses anteriores não pagos
      let mes = mb;
      while (mes < filtroMes) {
        if (!pagoMeses[mes]) {
          linhas.push({
            ...c,
            id: `${c.id}_${mes}`,
            _idOriginal: c.id,
            vencimento: `${mes}-${dia}`,
            pago: false,
            _mesOrigem: mes,
            _mesFiltro: mes,
            _atrasada: true,
            _labelAtraso: `Atrasada — ${MESES[Number(mes.split("-")[1])-1]}/${mes.split("-")[0]}`,
          });
        }
        mes = addMeses(mes, 1);
      }

      // Mês atual
      linhas.push({
        ...c,
        id: `${c.id}_${filtroMes}`,
        _idOriginal: c.id,
        vencimento: `${filtroMes}-${dia}`,
        pago: pagoMeses[filtroMes] || false,
        _mesOrigem: filtroMes,
        _mesFiltro: filtroMes,
      });
      continue;
    }

    // ── Parcelada (recorrente com totalParcelas definido) ──
    if (totalParcelas > 0) {
      // parcelaAtual indica qual parcela cai no mês de vencimento (mb)
      // Ex: financiamento mês Jun, parcela 4 de 48
      // → parcela 4 = mb, parcela 5 = mb+1, parcela 3 = mb-1 etc.
      const parcelaAtual = c.parcelaAtual ? Number(c.parcelaAtual) : 1;
      const parcelasRestantes = totalParcelas - parcelaAtual + 1; // quantas ainda faltam a partir de mb

      for (let i = 0; i < parcelasRestantes; i++) {
        const numParcela = parcelaAtual + i;
        const mesParcela = addMeses(mb, i);
        const paga = pagoMeses[mesParcela] || false;

        if (mesParcela === filtroMes) {
          linhas.push({
            ...c,
            id: `${c.id}_p${numParcela}`,
            _idOriginal: c.id,
            vencimento: `${mesParcela}-${dia}`,
            pago: paga,
            _parcela: {atual: numParcela, total: totalParcelas},
            _mesOrigem: mesParcela,
            _mesFiltro: mesParcela,
          });
        } else if (mesParcela < filtroMes && !paga) {
          linhas.push({
            ...c,
            id: `${c.id}_p${numParcela}_atrasada`,
            _idOriginal: c.id,
            vencimento: `${filtroMes}-${dia}`,
            pago: false,
            _parcela: {atual: numParcela, total: totalParcelas},
            _mesOrigem: mesParcela,
            _mesFiltro: mesParcela,
            _atrasada: true,
            _labelAtraso: `Parcela ${numParcela}/${totalParcelas} — atrasada de ${MESES[Number(mesParcela.split("-")[1])-1]}/${mesParcela.split("-")[0]}`,
          });
        }
      }
    }
  }

  // Remove duplicatas
  const seen = new Set();
  return linhas.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });
}

function getStatusLinha(l) {
  if (l.pago) return "pago";
  const d = daysUntil(l.vencimento);
  return d < 0 ? "vencido" : "pendente";
}

// ─── APP ─────────────────────────────────────────────────────
export default function App() {
  const [tab,          setTab]         = useState("dashboard");
  const [contas,       setContas]      = useState([]);
  const [cartoes,      setCartoes]     = useState([]);
  const [compras,      setCompras]     = useState([]);
  const [faturasPagas, setFaturasPagas]= useState({});
  const [loading,      setLoading]     = useState(true);
  const [toast,        setToast]       = useState(null);
  const [modal,        setModal]       = useState(null);
  const [confirm,      setConfirm]     = useState(null);
  const [filtroMes,    setFiltroMes]   = useState(mesAtualStr);
  const [filtrocat,    setFiltrocat]   = useState("todas");
  const [metaMensal,   setMetaMensal]  = useState(()=>{ try{ return Number(localStorage.getItem("cc-meta"))||0; }catch(e){return 0;} });
  const [temaClaro,    setTemaClaro]   = useState(()=>{ try{ return localStorage.getItem("cc-tema")==="claro"; }catch(e){return false;} });

  function toggleTema(){ setTemaClaro(t=>{ const n=!t; try{localStorage.setItem("cc-tema",n?"claro":"escuro");}catch(e){} return n; }); }
  function salvarMeta(v){ const n=Number(v)||0; setMetaMensal(n); try{localStorage.setItem("cc-meta",n);}catch(e){} }

  useEffect(() => {
    (async () => {
      try {
        const [c, ca, co, fp] = await Promise.all([
          getContas(), getCartoes(), getCompras(), getFaturasPagas(),
        ]);
        setContas(c); setCartoes(ca); setCompras(co); setFaturasPagas(fp);
      } catch (e) {
        toast_("Erro ao carregar dados", "err");
        console.error(e);
      }
      setLoading(false);
    })();
  }, []);

  const toast_ = (msg, type="ok") => { setToast({msg,type}); setTimeout(()=>setToast(null),2800); };

  // ── CONTAS ──
  async function saveConta(form) {
    if (!form.nome.trim()||!form.valor||!form.vencimento) { toast_("Preencha nome, valor e vencimento","err"); return; }
    try {
      const saved = await upsertConta({
        id:            form.id || uid(),
        nome:          form.nome,
        categoria:     form.categoria,
        valor:         form.valor,
        vencimento:    form.vencimento,
        pago:          form.pago,
        recorrente:    form.recorrente,
        parcelaAtual:  form.parcelaAtual ? Number(form.parcelaAtual) : null,
        totalParcelas: form.totalParcelas ? Number(form.totalParcelas) : null,
        pagoMeses:     form.pagoMeses || {},
        obs:           form.obs || "",
      });
      setContas(prev => form.id ? prev.map(c => c.id===form.id ? saved : c) : [...prev, saved]);
      toast_(form.id ? "Conta atualizada!" : "Conta adicionada!");
      setModal(null);
    } catch(e) { console.error(e); toast_("Erro ao salvar conta","err"); }
  }

  async function deleteConta(id) {
    try {
      await dbDeleteConta(id);
      setContas(prev => prev.filter(c => c.id !== id));
      setConfirm(null); toast_("Removido");
    } catch(e) { toast_("Erro ao remover","err"); }
  }

  async function togglePago(linha, isFatura=false) {
    if (isFatura) {
      const atual = faturasPagas[`${linha.cartaoId}_${filtroMes}`] || false;
      try {
        await toggleFaturaPaga(linha.cartaoId, filtroMes, !atual);
        setFaturasPagas(prev => ({...prev, [`${linha.cartaoId}_${filtroMes}`]: !atual}));
        toast_(!atual ? "Fatura marcada como paga ✓" : "Fatura desmarcada");
      } catch(e) { toast_("Erro ao atualizar fatura","err"); }
      return;
    }

    const idOriginal = linha._idOriginal || linha.id;
    const contaOriginal = contas.find(c => c.id === idOriginal);
    if (!contaOriginal) return;

    // Conta simples
    if (!contaOriginal.recorrente && !contaOriginal.totalParcelas) {
      try {
        await toggleContaPago(idOriginal, !linha.pago);
        setContas(prev => prev.map(c => c.id===idOriginal ? {...c, pago: !linha.pago} : c));
        toast_(linha.pago ? "Desmarcado" : "Marcado como pago ✓");
      } catch(e) { toast_("Erro ao atualizar","err"); }
      return;
    }

    // Recorrente ou parcelada — usa pagoMeses
    const mesFiltro = linha._mesFiltro || filtroMes;
    const pagoMeses = {...(contaOriginal.pagoMeses || {})};
    pagoMeses[mesFiltro] = !linha.pago;
    try {
      const saved = await upsertConta({...contaOriginal, pagoMeses});
      setContas(prev => prev.map(c => c.id===idOriginal ? saved : c));
      toast_(linha.pago ? "Desmarcado" : "Marcado como pago ✓");
    } catch(e) { toast_("Erro ao atualizar","err"); }
  }

  // ── CARTÕES ──
  async function saveCartao(form) {
    if (!form.nome.trim()) { toast_("Informe o nome do cartão","err"); return; }
    try {
      const saved = await upsertCartao({
        id: form.id || uid(), nome: form.nome,
        bandeira: form.bandeira, limite: form.limite || null, obs: form.obs || "",
      });
      setCartoes(prev => form.id ? prev.map(c => c.id===form.id ? saved : c) : [...prev, saved]);
      toast_(form.id ? "Cartão atualizado!" : "Cartão adicionado!");
      setModal(null);
    } catch(e) { console.error(e); toast_("Erro ao salvar cartão","err"); }
  }

  async function deleteCartao(id) {
    try {
      await dbDeleteCartao(id);
      setCartoes(prev => prev.filter(c => c.id !== id));
      setCompras(prev => prev.filter(c => c.cartaoId !== id));
      setConfirm(null); toast_("Cartão removido");
    } catch(e) { toast_("Erro ao remover cartão","err"); }
  }

  // ── COMPRAS ──
  async function saveCompra(form) {
    if (!form.cartaoId||!form.descricao.trim()||!form.valor||!form.mes) { toast_("Preencha todos os campos obrigatórios","err"); return; }
    try {
      const saved = await upsertCompra({
        id: form.id || uid(), cartaoId: form.cartaoId, descricao: form.descricao,
        valor: form.valor, totalParcelas: form.totalParcelas, parcelaAtual: form.parcelaAtual,
        mes: form.mes, obs: form.obs || "", recorrente: form.recorrente || false,
      });
      setCompras(prev => form.id ? prev.map(c => c.id===form.id ? saved : c) : [...prev, saved]);
      toast_(form.id ? "Compra atualizada!" : "Compra adicionada!");
      setModal(null);
    } catch(e) { console.error(e); toast_("Erro ao salvar compra","err"); }
  }

  async function deleteCompra(id) {
    try {
      await dbDeleteCompra(id);
      setCompras(prev => prev.filter(c => c.id !== id));
      setConfirm(null); toast_("Compra removida");
    } catch(e) { toast_("Erro ao remover compra","err"); }
  }

  // ── COMPUTED ──
  const contasExpandidas = expandirContasParaMes(contas, filtroMes);
  const contasRS = contasExpandidas.map(c => ({...c, status: getStatusLinha(c)}));

  // Expande compras parceladas e recorrentes para o mês correto
  function comprasDoMes(cartaoId, mes) {
    const resultado = [];
    for (const c of compras) {
      if (c.cartaoId !== cartaoId) continue;
      // Recorrente eterna — aparece todo mês a partir do mês de cadastro
      if (c.recorrente) {
        if (mes >= c.mes) resultado.push({...c, _numParcela: null, _totalParcelas: null, _recorrente: true});
        continue;
      }
      const total = Number(c.totalParcelas) || 1;
      if (total <= 1) {
        if (c.mes === mes) resultado.push({...c, _numParcela: 1, _totalParcelas: 1});
      } else {
        for (let i = 0; i < total; i++) {
          const mesParcela = addMeses(c.mes, i);
          if (mesParcela === mes) {
            resultado.push({...c, _numParcela: i + 1, _totalParcelas: total});
            break;
          }
        }
      }
    }
    return resultado;
  }

  function faturaCartao(cartaoId, mes) {
    return comprasDoMes(cartaoId, mes).reduce((s,c)=>s+Number(c.valor),0);
  }

  const faturas = cartoes.map(cartao => {
    const total = faturaCartao(cartao.id, filtroMes);
    if (total===0) return null;
    const pago = faturasPagas[`${cartao.id}_${filtroMes}`] || false;
    const ban = BANDEIRAS.find(b=>b.id===cartao.bandeira)||BANDEIRAS[6];
    return { _fatura:true, cartaoId:cartao.id, nome:`Fatura ${cartao.nome}`, valor:total, pago, cor:ban.cor, icon:ban.icon, bandLabel:ban.label };
  }).filter(Boolean);

  const todasLinhas = [
    ...contasRS,
    ...faturas.map(f => ({...f, status: f.pago?"pago":"pendente"}))
  ];

  const totalFixas   = contasRS.reduce((s,c)=>s+Number(c.valor),0);
  const pagoFixas    = contasRS.filter(c=>c.status==="pago").reduce((s,c)=>s+Number(c.valor),0);
  const totalFaturas = faturas.reduce((s,f)=>s+f.valor,0);
  const pagoFaturas  = faturas.filter(f=>f.pago).reduce((s,f)=>s+f.valor,0);
  const totalGeral   = totalFixas+totalFaturas;
  const totalPago    = pagoFixas+pagoFaturas;

  const proximas = todasLinhas
    .filter(c=>c.status!=="pago")
    .sort((a,b)=>{ if(a._fatura&&!b._fatura) return 1; if(!a._fatura&&b._fatura) return -1; return new Date(a.vencimento)-new Date(b.vencimento); })
    .slice(0,6);

  if (loading) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#f8fafc"}}>
      <div style={{width:40,height:40,border:"3px solid #e5e7eb",borderTop:"3px solid #4f46e5",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <p style={{color:"#9ca3af",marginTop:16,fontSize:13}}>Carregando dados...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={S.app}>
      <style>{CSS}</style>

      {toast&&<div style={{...S.toast,background:toast.type==="err"?"#ef4444":"#10b981"}}>{toast.type==="err"?"⚠️":"✓"} {toast.msg}</div>}

      {confirm&&(
        <div style={S.overlayTop} onClick={()=>setConfirm(null)}>
          <div style={S.mbox} onClick={e=>e.stopPropagation()}>
            <p style={S.mtitle}>Confirmar exclusão</p>
            <p style={S.msub}>"{confirm.nome||confirm.descricao}" será removido permanentemente.</p>
            <div style={S.mbrow}>
              <button style={S.bghost} onClick={()=>setConfirm(null)}>Cancelar</button>
              <button style={S.bdanger} onClick={()=>{
                if(confirm._type==="cartao")      deleteCartao(confirm.id);
                else if(confirm._type==="compra") deleteCompra(confirm.id);
                else deleteConta(confirm._idOriginal || confirm.id);
              }}>Excluir</button>
            </div>
          </div>
        </div>
      )}

      {modal&&(
        <div style={S.overlay} onClick={()=>setModal(null)}>
          <div style={{...S.mbox,maxHeight:"92vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            {modal.type==="meta"      && <FormMeta meta={metaMensal} onSave={v=>{salvarMeta(v);setModal(null);}} onClose={()=>setModal(null)}/>}
            {modal.type==="conta"     && <FormConta   data={modal.data} filtroMes={filtroMes} onSave={saveConta}  onClose={()=>setModal(null)}/>}
            {modal.type==="cartao"    && <FormCartao  data={modal.data}                        onSave={saveCartao} onClose={()=>setModal(null)}/>}
            {modal.type==="compra"    && <FormCompra  data={modal.data} cartoes={cartoes} filtroMes={filtroMes} onSave={saveCompra} onClose={()=>setModal(null)}/>}
            {modal.type==="verCartao" && (
              <VerCartao
                cartao={modal.data} compras={compras} filtroMes={filtroMes}
                onNovaCompra={()=>setModal({type:"compra",data:{cartaoId:modal.data.id,mes:filtroMes}})}
                onEditCompra={c=>setModal({type:"compra",data:c})}
                onDelCompra={c=>{setModal(null);setConfirm({...c,_type:"compra"});}}
                onEditCartao={()=>setModal({type:"cartao",data:modal.data})}
                onDelCartao={()=>setConfirm({...modal.data,_type:"cartao"})}
              />
            )}
          </div>
        </div>
      )}

      <header style={S.header}>
        <div style={S.htop}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={S.logo}>💰 CasaConta</span>
            <MesPicker value={filtroMes} onChange={setFiltroMes} temaClaro={temaClaro}/>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button onClick={()=>setModal({type:"meta"})} style={{background:"none",border:"none",fontSize:18,cursor:"pointer"}} title="Meta mensal">🎯</button>
            <button onClick={toggleTema} style={{background:"none",border:"none",fontSize:18,cursor:"pointer"}} title="Alternar tema">{temaClaro?"🌙":"☀️"}</button>
          </div>
        </div>
        <nav style={S.nav}>
          {[["dashboard","📊 Resumo"],["contas","📋 Contas"],["cartoes","💳 Cartões"]].map(([v,l])=>(
            <button key={v} style={{...S.nbtn,...(tab===v?S.nact:{})}} onClick={()=>setTab(v)}>{l}</button>
          ))}
        </nav>
      </header>

      <main style={S.main}>

        {tab==="dashboard"&&(
          <div className="fadeUp">
            <div style={S.g2}>
              <BigCard label="Total do mês" value={fmtBRL(totalGeral)} sub={`${todasLinhas.length} lançamentos`} cor="#4f46e5"/>
              <BigCard label="Total pago"   value={fmtBRL(totalPago)}  sub={`${Math.round(totalGeral>0?(totalPago/totalGeral)*100:0)}% quitado`} cor="#10b981"/>
            </div>
            <div style={S.g2}>
              <BigCard label="Contas fixas"   value={fmtBRL(totalFixas)}   sub={`${contasRS.length} lançamento${contasRS.length!==1?"s":""}`} cor="#4f46e5"/>
              <BigCard label="Faturas cartão" value={fmtBRL(totalFaturas)} sub={`${faturas.length} cartão${faturas.length!==1?"ões":""}`}      cor="#4f46e5"/>
            </div>

            {totalGeral>0&&(
              <div style={S.box}>
                <p style={S.bxtitle}>Progresso do mês</p>
                <div style={S.pbar}><div style={{...S.pfill,width:`${Math.min((totalPago/totalGeral)*100,100)}%`}}/></div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
                  <span style={S.plabel}>{Math.round((totalPago/totalGeral)*100)}% pago</span>
                  <span style={S.plabel}>{fmtBRL(totalGeral-totalPago)} a pagar</span>
                </div>
              </div>
            )}

            {metaMensal>0&&(
              <div style={S.box}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <p style={S.bxtitle}>🎯 Meta mensal</p>
                  <span style={{fontSize:12,color: totalGeral>metaMensal?"#ef4444":"#10b981",fontWeight:700}}>
                    {fmtBRL(totalGeral)} / {fmtBRL(metaMensal)}
                  </span>
                </div>
                <div style={S.pbar}>
                  <div style={{...S.pfill, width:`${Math.min((totalGeral/metaMensal)*100,100)}%`, background: totalGeral>metaMensal?"linear-gradient(90deg,#ef4444,#f97316)":"linear-gradient(90deg,#10b981,#34d399)"}}/>
                </div>
                <p style={{fontSize:11,color: totalGeral>metaMensal?"#ef4444":"#64748b",marginTop:6}}>
                  {totalGeral>metaMensal ? `⚠️ Estourou ${fmtBRL(totalGeral-metaMensal)} acima da meta` : `✓ ${fmtBRL(metaMensal-totalGeral)} ainda disponível`}
                </p>
              </div>
            )}

            <div style={S.box}>
              <p style={S.bxtitle}>Pendentes / Vencidos</p>
              {proximas.length===0
                ?<p style={S.empty}>Tudo pago! 🎉</p>
                :proximas.map((c,i)=>{
                  if(c._fatura){
                    return(
                      <div key={c.cartaoId} style={S.prow}>
                        <span style={{fontSize:20,width:30,textAlign:"center"}}>{c.icon}</span>
                        <div style={{flex:1}}>
                          <p style={S.pnome}>{c.nome}</p>
                          <p style={S.pdata}>{c.bandLabel}</p>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <p style={S.pvalor}>{fmtBRL(c.valor)}</p>
                          <span style={{...S.badge,background:"#ede9fe",color:"#4f46e5"}}>Fatura</span>
                        </div>
                      </div>
                    );
                  }
                  const d=daysUntil(c.vencimento);
                  const cat=CATS.find(x=>x.id===c.categoria);
                  return(
                    <div key={c.id} style={S.prow}>
                      <span style={{fontSize:20,width:30,textAlign:"center"}}>{cat?.icon}</span>
                      <div style={{flex:1}}>
                        <p style={S.pnome}>{c.nome}{c._atrasada?" ⚠️":""}</p>
                        <p style={S.pdata}>{c._labelAtraso || fmtDate(c.vencimento)}</p>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <p style={S.pvalor}>{fmtBRL(c.valor)}</p>
                        <span style={{...S.badge,background:d<0?"#ef444422":d<=3?"#f59e0b22":"#1e293b",color:d<0?"#ef4444":d<=3?"#f59e0b":"#64748b"}}>
                          {d<0?`${Math.abs(d)}d atrás`:d===0?"Hoje":`${d}d`}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>

            {cartoes.length>0&&(
              <div style={S.box}>
                <p style={S.bxtitle}>Faturas deste mês</p>
                {cartoes.map(cartao=>{
                  const tot=faturaCartao(cartao.id,filtroMes);
                  const ban=BANDEIRAS.find(b=>b.id===cartao.bandeira)||BANDEIRAS[6];
                  const pago=faturasPagas[`${cartao.id}_${filtroMes}`]||false;
                  return(
                    <div key={cartao.id} style={{...S.prow,cursor:"pointer"}} onClick={()=>setModal({type:"verCartao",data:cartao})}>
                      <div style={{width:36,height:36,borderRadius:10,background:ban.cor+"33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{ban.icon}</div>
                      <div style={{flex:1}}>
                        <p style={S.pnome}>{cartao.nome}</p>
                        <p style={S.pdata}>{comprasDoMes(cartao.id,filtroMes).length} compra{comprasDoMes(cartao.id,filtroMes).length!==1?"s":""}</p>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <p style={S.pvalor}>{fmtBRL(tot)}</p>
                        <span style={{...S.badge,background:pago?"#10b98122":"#ede9fe",color:pago?"#10b981":"#4f46e5"}}>{pago?"Pago":"Aberta"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {todasLinhas.length===0&&cartoes.length===0&&(
              <div style={S.estate}>
                <div style={{fontSize:52,marginBottom:10}}>🏠</div>
                <p style={{color:"#111827",fontWeight:700,fontSize:20,fontFamily:"'Playfair Display',serif",marginBottom:6}}>Comece agora!</p>
                <p style={{color:"#6b7280",fontSize:13,marginBottom:20,textAlign:"center"}}>Adicione contas fixas e cadastre seus cartões</p>
                <div style={{display:"flex",gap:10}}>
                  <button style={S.bprimary} onClick={()=>setModal({type:"conta",data:null})}>+ Conta</button>
                  <button style={{...S.bprimary,background:"#4f46e5"}} onClick={()=>setModal({type:"cartao",data:null})}>+ Cartão</button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab==="contas"&&(
          <div className="fadeUp">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {["todas",...CATS.map(c=>c.id)].map(id=>{
                  const cat=CATS.find(c=>c.id===id);
                  const ativo=filtrocat===id;
                  return(
                    <button key={id} onClick={()=>setFiltrocat(id)} style={{
                      background: ativo?"#4f46e5":"#f1f5f9",
                      color: ativo?"#fff":"#64748b",
                      border:"none",borderRadius:100,padding:"4px 10px",fontSize:12,fontWeight:ativo?700:400,cursor:"pointer"
                    }}>{cat?`${cat.icon} ${cat.label}`:"Todas"}</button>
                  );
                })}
              </div>
              <button style={S.bprimary} onClick={()=>setModal({type:"conta",data:null})}>+ Nova</button>
            </div>

            {faturas.length>0&&(
              <div style={{marginBottom:16}}>
                <p style={{...S.bxtitle,marginBottom:8,color:"#4f46e5"}}>💳 Faturas de cartão</p>
                {faturas.map(f=>{
                  const ban=BANDEIRAS.find(b=>b.id===cartoes.find(c=>c.id===f.cartaoId)?.bandeira)||BANDEIRAS[6];
                  return(
                    <div key={f.cartaoId} style={{...S.ccard,borderLeft:`3px solid ${ban.cor}`}}>
                      <div style={S.ctop}>
                        <div style={{display:"flex",gap:10,alignItems:"center"}}>
                          <span style={{fontSize:22}}>{ban.icon}</span>
                          <div>
                            <p style={S.cnome}>{f.nome}</p>
                            <p style={S.ccat}>{compras.filter(c=>c.cartaoId===f.cartaoId&&c.mes===filtroMes).length} compras · {ban.label}</p>
                          </div>
                        </div>
                        <p style={S.cvalor}>{fmtBRL(f.valor)}</p>
                      </div>
                      <div style={S.cbot}>
                        <span style={{...S.badge,background:f.pago?"#10b98122":"#ede9fe",color:f.pago?"#10b981":"#4f46e5",border:`1px solid ${f.pago?"#10b98144":"#c4b5fd"}`}}>
                          {f.pago?"Paga":"Em aberto"}
                        </span>
                        <div style={{flex:1}}/>
                        <Btn bg={f.pago?"#f3f4f6":"#d1fae5"} color={f.pago?"#9ca3af":"#059669"} onClick={()=>togglePago(f,true)}>{f.pago?"↩ Desmarcar":"✓ Pagar"}</Btn>
                        <Btn bg="#f8fafc" color="#64748b" onClick={()=>setModal({type:"verCartao",data:cartoes.find(c=>c.id===f.cartaoId)})}>Ver detalhes</Btn>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {contasRS.filter(c=>filtrocat==="todas"||c.categoria===filtrocat).length>0&&<p style={{...S.bxtitle,marginBottom:8,color:"#4f46e5"}}>📋 Contas fixas</p>}
            {contasRS.filter(c=>filtrocat==="todas"||c.categoria===filtrocat).sort((a,b)=>new Date(a.vencimento)-new Date(b.vencimento)).map(c=>{
              const cat=CATS.find(x=>x.id===c.categoria);
              const st=ST[c.status];
              const d=daysUntil(c.vencimento);
              return(
                <div key={c.id} style={{...S.ccard, borderLeft: c._atrasada?"3px solid #ef4444":"3px solid transparent"}}>
                  <div style={S.ctop}>
                    <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                      <span style={{fontSize:22}}>{cat?.icon}</span>
                      <div>
                        <p style={S.cnome}>{c.nome}{c._atrasada?" ⚠️":""}</p>
                        <p style={S.ccat}>
                          {cat?.label}
                          {c.recorrente&&!c.totalParcelas?" · 🔁 Recorrente":""}
                          {c._parcela?` · Parcela ${c._parcela.atual}/${c._parcela.total}`:""}
                          {c._labelAtraso?` · ${c._labelAtraso}`:""}
                        </p>
                      </div>
                    </div>
                    <p style={S.cvalor}>{fmtBRL(c.valor)}</p>
                  </div>
                  <div style={S.cbot}>
                    <span style={{...S.badge,background:st.bg,color:st.cor,border:`1px solid ${st.cor}44`}}>{st.label}</span>
                    <span style={{color:"#475569",fontSize:12,flex:1}}>
                      📅 {fmtDate(c.vencimento)}
                      {c.status!=="pago"&&<span style={{color:d<0?"#ef4444":d<=3?"#f59e0b":"#475569",marginLeft:4}}>
                        ({d<0?`${Math.abs(d)}d atrás`:d===0?"hoje":`${d}d`})
                      </span>}
                    </span>
                    <Btn bg={c.status==="pago"?"#f3f4f6":"#d1fae5"} color={c.status==="pago"?"#9ca3af":"#059669"} onClick={()=>togglePago(c)}>{c.status==="pago"?"↩":"✓"}</Btn>
                    <Btn bg="#eef2ff" color="#4f46e5" onClick={()=>setModal({type:"conta",data:contas.find(x=>x.id===(c._idOriginal||c.id))||c})}>✏️</Btn>
                    <Btn bg="#fef2f2" color="#dc2626" onClick={()=>setConfirm({...c,_type:"conta"})}>🗑</Btn>
                  </div>
                  {c.obs&&<p style={S.obs}>💬 {c.obs}</p>}
                </div>
              );
            })}

            {todasLinhas.length===0&&(
              <div style={S.estate}><p style={{color:"#64748b"}}>Nenhum lançamento neste mês</p></div>
            )}
          </div>
        )}

        {tab==="cartoes"&&(
          <div className="fadeUp">
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
              <button style={{...S.bprimary,background:"#4f46e5"}} onClick={()=>setModal({type:"cartao",data:null})}>+ Novo cartão</button>
            </div>

            {cartoes.length===0&&(
              <div style={S.estate}>
                <div style={{fontSize:48,marginBottom:10}}>💳</div>
                <p style={{color:"#94a3b8",marginBottom:16}}>Nenhum cartão cadastrado</p>
                <button style={{...S.bprimary,background:"#4f46e5"}} onClick={()=>setModal({type:"cartao",data:null})}>Adicionar cartão</button>
              </div>
            )}

            {cartoes.map(cartao=>{
              const ban=BANDEIRAS.find(b=>b.id===cartao.bandeira)||BANDEIRAS[6];
              const totMes=faturaCartao(cartao.id,filtroMes);
              const totCompras=compras.filter(c=>c.cartaoId===cartao.id).length;
              const pago=faturasPagas[`${cartao.id}_${filtroMes}`]||false;
              return(
                <div key={cartao.id} style={{...S.ccard,borderLeft:`4px solid ${ban.cor}`,cursor:"pointer"}} onClick={()=>setModal({type:"verCartao",data:cartao})}>
                  <div style={S.ctop}>
                    <div style={{display:"flex",gap:12,alignItems:"center"}}>
                      <div style={{width:44,height:44,borderRadius:12,background:ban.cor+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>{ban.icon}</div>
                      <div>
                        <p style={S.cnome}>{cartao.nome}</p>
                        <p style={S.ccat}>{ban.label} · {totCompras} compra{totCompras!==1?"s":""} total</p>
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <p style={S.cvalor}>{fmtBRL(totMes)}</p>
                      <p style={{fontSize:11,color:"#64748b"}}>este mês</p>
                    </div>
                  </div>
                  <div style={S.cbot}>
                    <span style={{...S.badge,background:pago?"#10b98122":"#ede9fe",color:pago?"#10b981":"#4f46e5"}}>
                      {pago?"Fatura paga":"Fatura aberta"}
                    </span>
                    {cartao.limite&&<span style={{...S.badge,background:"#1e293b",color:"#64748b"}}>Limite: {fmtBRL(cartao.limite)}</span>}
                    <div style={{flex:1}}/>
                    <Btn bg="#eef2ff" color="#4f46e5" onClick={e=>{e.stopPropagation();setModal({type:"cartao",data:cartao})}}>✏️</Btn>
                    <Btn bg="#fef2f2" color="#dc2626" onClick={e=>{e.stopPropagation();setConfirm({...cartao,_type:"cartao"})}}>🗑</Btn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <div style={S.fab}>
        {tab==="cartoes"  &&<FabBtn label="+ Compra" onClick={()=>setModal({type:"compra",data:null})} bg="#4f46e5"/>}
        {tab==="contas"   &&<FabBtn label="+ Conta"  onClick={()=>setModal({type:"conta",data:null})}/>}
        {tab==="dashboard"&&<>
          <FabBtn label="+ Conta"  onClick={()=>setModal({type:"conta",data:null})}/>
          <FabBtn label="+ Cartão" onClick={()=>setModal({type:"cartao",data:null})} bg="#4f46e5"/>
        </>}
      </div>
    </div>
  );
}

// ─── MODAL: VER CARTÃO ────────────────────────────────────────
function VerCartao({cartao,compras,filtroMes,onNovaCompra,onEditCompra,onDelCompra,onEditCartao,onDelCartao}){
  const ban=BANDEIRAS.find(b=>b.id===cartao.bandeira)||BANDEIRAS[6];
  const [mesSel,setMesSel]=useState(filtroMes);
  // Expande parceladas igual ao app principal
  function comprasDoMesLocal(cartaoId, mes) {
    const resultado = [];
    for (const c of compras) {
      if (c.cartaoId !== cartaoId) continue;
      if (c.recorrente) {
        if (mes >= c.mes) resultado.push({...c, _numParcela: null, _totalParcelas: null, _recorrente: true});
        continue;
      }
      const total = Number(c.totalParcelas) || 1;
      if (total <= 1) {
        if (c.mes === mes) resultado.push({...c, _numParcela: 1, _totalParcelas: 1});
      } else {
        for (let i = 0; i < total; i++) {
          const mesParcela = addMeses(c.mes, i);
          if (mesParcela === mes) {
            resultado.push({...c, _numParcela: i + 1, _totalParcelas: total});
            break;
          }
        }
      }
    }
    return resultado;
  }
  const comprasSel=comprasDoMesLocal(cartao.id, mesSel);
  const totalSel=comprasSel.reduce((s,c)=>s+Number(c.valor),0);
  return(
    <div>
      <div style={{background:"#fff",borderRadius:14,padding:"16px",marginBottom:16,display:"flex",gap:14,alignItems:"center",border:"1px solid #e5e7eb",borderLeft:`4px solid ${ban.cor}`}}>
        <div style={{width:50,height:50,borderRadius:14,background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>{ban.icon}</div>
        <div style={{flex:1}}>
          <p style={{color:"#111827",fontWeight:700,fontSize:18,fontFamily:"'Playfair Display',serif"}}>{cartao.nome}</p>
          <p style={{color:"#6b7280",fontSize:13}}>{ban.label}{cartao.limite?` · Limite ${fmtBRL(cartao.limite)}`:""}</p>
        </div>
        <div style={{display:"flex",gap:6}}>
          <Btn bg="#eef2ff" color="#4f46e5" onClick={onEditCartao}>✏️</Btn>
          <Btn bg="#fef2f2" color="#dc2626" onClick={onDelCartao}>🗑</Btn>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,padding:"10px 14px",background:"#f9fafb",borderRadius:12,border:"1px solid #e5e7eb"}}>
        <MesPicker value={mesSel} onChange={setMesSel}/>
        <span style={{color:"#111827",fontWeight:700,fontSize:16}}>{fmtBRL(totalSel)}</span>
      </div>
      {comprasSel.length===0
        ?<p style={{color:"#9ca3af",fontSize:13,textAlign:"center",padding:"16px 0"}}>Nenhuma compra neste mês</p>
        :comprasSel.map(c=>(
          <div key={c.id} style={{background:"#fff",borderRadius:12,padding:"14px",marginBottom:8,display:"flex",alignItems:"center",gap:12,border:"1px solid #e5e7eb"}}>
            <div style={{flex:1}}>
              <p style={{color:"#111827",fontWeight:600,fontSize:14,marginBottom:2}}>{c.descricao}</p>
              {c._recorrente&&<p style={{color:"#4f46e5",fontSize:12,fontWeight:500}}>🔁 Recorrente mensal</p>}
              {c._totalParcelas>1&&<p style={{color:"#6b7280",fontSize:12,marginTop:2}}>Parcela {c._numParcela}/{c._totalParcelas} · Total {fmtBRL(Number(c.valor)*c._totalParcelas)}</p>}
              {c.obs&&<p style={{color:"#9ca3af",fontSize:11,marginTop:2}}>💬 {c.obs}</p>}
            </div>
            <div style={{textAlign:"right"}}>
              <p style={{color:"#111827",fontWeight:700,fontSize:15}}>{fmtBRL(c.valor)}</p>
              <div style={{display:"flex",gap:4,justifyContent:"flex-end",marginTop:6}}>
                <Btn bg="#eef2ff" color="#4f46e5" onClick={()=>onEditCompra(c)}>✏️</Btn>
                <Btn bg="#fef2f2" color="#dc2626" onClick={()=>onDelCompra(c)}>🗑</Btn>
              </div>
            </div>
          </div>
        ))}
      <button style={{...S.bprimary,width:"100%",marginTop:12}} onClick={onNovaCompra}>+ Nova compra</button>
    </div>
  );
}

// ─── FORMS ───────────────────────────────────────────────────
function FormConta({data,filtroMes,onSave,onClose}){
  const [f,setF]=useState(data||{...EMPTY_CONTA,vencimento:filtroMes?`${filtroMes}-10`:""});
  const s=(k,v)=>setF(x=>({...x,[k]:v}));
  return(
    <div>
      <FHeader title={f.id?"Editar Conta":"Nova Conta"} onClose={onClose}/>
      <Lbl>Nome *</Lbl><Inp placeholder="Ex: Conta CELESC" value={f.nome} onChange={e=>s("nome",e.target.value)}/>
      <Lbl>Categoria</Lbl>
      <Sel value={f.categoria} onChange={e=>s("categoria",e.target.value)}>
        {CATS.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
      </Sel>
      <Lbl>Valor (R$) *</Lbl><Inp type="number" placeholder="0,00" value={f.valor} onChange={e=>s("valor",e.target.value)}/>
      <Lbl>Vencimento *</Lbl><Inp type="date" value={f.vencimento} onChange={e=>s("vencimento",e.target.value)}/>
      <Lbl>Status</Lbl>
      <Sel value={f.pago?"pago":"pendente"} onChange={e=>s("pago",e.target.value==="pago")}>
        <option value="pendente">Pendente</option><option value="pago">Pago</option>
      </Sel>

      <div style={{display:"flex",gap:10,alignItems:"center",marginTop:14}}>
        <input type="checkbox" id="rec" checked={!!f.recorrente} onChange={e=>s("recorrente",e.target.checked)} style={{width:16,height:16,accentColor:"#4f46e5"}}/>
        <label htmlFor="rec" style={{color:"#94a3b8",fontSize:14}}>🔁 Recorrente / Parcelada</label>
      </div>

      {f.recorrente&&(
        <div style={{marginTop:12,padding:"12px",background:"#0f172a",borderRadius:10,border:"1px solid #334155"}}>
          <p style={{color:"#64748b",fontSize:12,marginBottom:10}}>Deixe em branco se for eterna (luz, água, aluguel etc.)</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <Lbl>Parcela atual</Lbl>
              <Inp
                type="number" min="1" placeholder="Ex: 4"
                value={f.parcelaAtual||""}
                onChange={e=>s("parcelaAtual",e.target.value)}
              />
            </div>
            <div>
              <Lbl>Total de parcelas</Lbl>
              <Inp
                type="number" min="1" placeholder="Ex: 48"
                value={f.totalParcelas||""}
                onChange={e=>s("totalParcelas",e.target.value)}
              />
            </div>
          </div>
          {f.parcelaAtual&&f.totalParcelas&&(
            <p style={{fontSize:11,color:"#4f46e5",marginTop:8}}>
              📅 Parcela {f.parcelaAtual} de {f.totalParcelas} — termina em {addMeses(f.vencimento?f.vencimento.substring(0,7):mesAtualStr(), Number(f.totalParcelas)-Number(f.parcelaAtual)).replace("-","/")}
            </p>
          )}
          {(!f.parcelaAtual||!f.totalParcelas)&&(
            <p style={{fontSize:11,color:"#475569",marginTop:8}}>🔁 Aparece todo mês indefinidamente</p>
          )}
        </div>
      )}

      <Lbl>Observação</Lbl><Txa placeholder="Opcional..." value={f.obs||""} onChange={e=>s("obs",e.target.value)}/>
      <button style={{...S.bprimary,width:"100%",marginTop:18,padding:"13px"}} onClick={()=>onSave(f)}>
        {f.id?"Salvar":"Adicionar conta"}
      </button>
    </div>
  );
}

function FormMeta({meta,onSave,onClose}){
  const [v,setV]=useState(meta||"");
  return(
    <div>
      <FHeader title="🎯 Meta de gastos" onClose={onClose}/>
      <p style={{color:"#64748b",fontSize:13,marginBottom:16}}>Defina o limite de gastos mensais. Uma barra aparecerá no dashboard mostrando quanto você já comprometeu.</p>
      <Lbl>Valor da meta (R$)</Lbl>
      <Inp type="number" placeholder="Ex: 3000" value={v} onChange={e=>setV(e.target.value)}/>
      {v&&<p style={{fontSize:12,color:"#4f46e5",marginTop:6}}>Meta: {Number(v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})} / mês</p>}
      <button style={{...S.bprimary,width:"100%",marginTop:18,padding:"13px"}} onClick={()=>onSave(v)}>Salvar meta</button>
      {meta>0&&<button style={{width:"100%",marginTop:8,padding:"11px",background:"none",border:"1px solid #e5e7eb",borderRadius:12,color:"#6b7280",cursor:"pointer"}} onClick={()=>onSave(0)}>Remover meta</button>}
    </div>
  );
}

function FormCartao({data,onSave,onClose}){
  const [f,setF]=useState(data||EMPTY_CARTAO);
  const s=(k,v)=>setF(x=>({...x,[k]:v}));
  return(
    <div>
      <FHeader title={f.id?"Editar Cartão":"Novo Cartão"} onClose={onClose}/>
      <Lbl>Nome do cartão *</Lbl><Inp placeholder="Ex: Nubank pessoal" value={f.nome} onChange={e=>s("nome",e.target.value)}/>
      <Lbl>Bandeira</Lbl>
      <Sel value={f.bandeira} onChange={e=>s("bandeira",e.target.value)}>
        {BANDEIRAS.map(b=><option key={b.id} value={b.id}>{b.icon} {b.label}</option>)}
      </Sel>
      <Lbl>Limite (R$) — opcional</Lbl><Inp type="number" placeholder="0,00" value={f.limite||""} onChange={e=>s("limite",e.target.value)}/>
      <Lbl>Observação</Lbl><Txa placeholder="Opcional..." value={f.obs||""} onChange={e=>s("obs",e.target.value)}/>
      <button style={{...S.bprimary,width:"100%",marginTop:18,padding:"13px",background:"#4f46e5"}} onClick={()=>onSave(f)}>
        {f.id?"Salvar":"Adicionar cartão"}
      </button>
    </div>
  );
}

function FormCompra({data,cartoes,filtroMes,onSave,onClose}){
  const [f,setF]=useState(data||{...EMPTY_COMPRA,cartaoId:cartoes[0]?.id||"",mes:filtroMes});
  const s=(k,v)=>setF(x=>({...x,[k]:v}));
  const total = Number(f.totalParcelas)||1;
  const termina = total>1 ? addMeses(f.mes||filtroMes, total-1) : null;
  return(
    <div>
      <FHeader title={f.id?"Editar Compra":"Nova Compra"} onClose={onClose}/>
      <Lbl>Cartão *</Lbl>
      <Sel value={f.cartaoId} onChange={e=>s("cartaoId",e.target.value)}>
        {cartoes.length===0&&<option value="">Nenhum cartão cadastrado</option>}
        {cartoes.map(c=>{ const b=BANDEIRAS.find(x=>x.id===c.bandeira)||BANDEIRAS[6]; return <option key={c.id} value={c.id}>{b.icon} {c.nome}</option>; })}
      </Sel>
      <Lbl>Mês da 1ª parcela *</Lbl><Inp type="month" value={f.mes} onChange={e=>s("mes",e.target.value)}/>
      <Lbl>Descrição *</Lbl><Inp placeholder="Ex: TV Samsung" value={f.descricao} onChange={e=>s("descricao",e.target.value)}/>
      <div style={{display:"flex",gap:10,alignItems:"center",marginTop:14,marginBottom:4}}>
        <input type="checkbox" id="rec_compra" checked={!!f.recorrente} onChange={e=>s("recorrente",e.target.checked)} style={{width:16,height:16,accentColor:"#4f46e5"}}/>
        <label htmlFor="rec_compra" style={{color:"#94a3b8",fontSize:14}}>🔁 Recorrente (assinatura mensal)</label>
      </div>

      {!f.recorrente&&<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <Lbl>Valor total da compra (R$)</Lbl>
            <Inp type="number" placeholder="0,00" value={f.valorTotal||""} onChange={e=>{
              s("valorTotal",e.target.value);
              if(e.target.value && Number(f.totalParcelas)>1) s("valor",(Number(e.target.value)/Number(f.totalParcelas)).toFixed(2));
            }}/>
          </div>
          <div>
            <Lbl>Total de parcelas</Lbl>
            <Inp type="number" min="1" placeholder="1 = à vista" value={f.totalParcelas} onChange={e=>{
              s("totalParcelas",e.target.value);
              if(f.valorTotal && Number(e.target.value)>1) s("valor",(Number(f.valorTotal)/Number(e.target.value)).toFixed(2));
            }}/>
          </div>
        </div>
        {termina&&total>1&&f.mes&&f.valor&&(
          <p style={{fontSize:11,color:"#4f46e5",marginTop:6}}>
            📅 {total}x de {fmtBRL(f.valor)} = {fmtBRL(Number(f.valor)*total)} total — última parcela em {termina.replace("-","/")}
          </p>
        )}
      </>}

      <Lbl>Valor {f.recorrente?"mensal":"de cada parcela"} (R$) *</Lbl>
      <Inp type="number" placeholder="0,00" value={f.valor} onChange={e=>s("valor",e.target.value)}/>
      {f.recorrente&&<p style={{fontSize:11,color:"#4f46e5",marginTop:6}}>🔁 Aparece todo mês a partir de {f.mes||"..."} até ser excluída</p>}
      <Lbl>Observação</Lbl><Txa placeholder="Opcional..." value={f.obs||""} onChange={e=>s("obs",e.target.value)}/>
      <button style={{...S.bprimary,width:"100%",marginTop:18,padding:"13px",background:"#4f46e5"}} onClick={()=>onSave(f)}>
        {f.id?"Salvar":"Adicionar compra"}
      </button>
    </div>
  );
}

// ─── MINI COMPONENTS ─────────────────────────────────────────
function BigCard({label,value,sub,cor}){
  return(
    <div style={{background:"#fff",borderRadius:16,padding:"16px",borderTop:`3px solid ${cor}`,boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>
      <p style={{fontSize:11,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>{label}</p>
      <p style={{fontSize:19,fontWeight:700,color:"#111827",fontFamily:"'Playfair Display',serif",marginBottom:2}}>{value}</p>
      <p style={{fontSize:11,color:"#6b7280"}}>{sub}</p>
    </div>
  );
}
function Btn({bg,color,onClick,children}){
  return <button style={{background:bg,color,border:"none",borderRadius:8,padding:"6px 10px",fontSize:13,fontWeight:600,whiteSpace:"nowrap",boxShadow:"0 1px 3px rgba(15,23,42,.08)"}} onClick={onClick}>{children}</button>;
}
function FabBtn({label,onClick,bg="#4f46e5"}){
  return <button style={{background:bg,color:"#fff",border:"none",borderRadius:100,padding:"10px 20px",fontWeight:700,fontSize:14,boxShadow:"0 4px 20px rgba(99,102,241,.35)"}} onClick={onClick}>{label}</button>;
}
function MesPicker({value,onChange,temaClaro}){
  const [y,m]=value.split("-").map(Number);
  const prev=()=>{ let nm=m-1,ny=y; if(nm<1){nm=12;ny--;} onChange(`${ny}-${String(nm).padStart(2,"0")}`); };
  const next=()=>{ let nm=m+1,ny=y; if(nm>12){nm=1;ny++;} onChange(`${ny}-${String(nm).padStart(2,"0")}`); };
  const bg="#f3f4f6";
  const cor="#374151";
  return(
    <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
      <button style={{background:"#f3f4f6",border:"1px solid #e5e7eb",color:"#374151",fontSize:16,width:28,height:28,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}} onClick={prev}>‹</button>
      <span style={{fontSize:13,color:"#374151",fontWeight:600,textTransform:"capitalize",minWidth:70,textAlign:"center"}}>{MESES[m-1]} {y}</span>
      <button style={{background:"#f3f4f6",border:"1px solid #e5e7eb",color:"#374151",fontSize:16,width:28,height:28,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}} onClick={next}>›</button>
    </span>
  );
}
function FHeader({title,onClose}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
      <h2 style={{color:"#111827",fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700}}>{title}</h2>
      <button style={{background:"#f3f4f6",border:"none",color:"#6b7280",fontSize:16,lineHeight:1,width:32,height:32,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}} onClick={onClose}>✕</button>
    </div>
  );
}
const Lbl=({children})=><label style={{display:"block",fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em",marginTop:14,marginBottom:5}}>{children}</label>;
const Inp=(p)=><input {...p} style={{width:"100%",padding:"10px 12px",background:"#f3f4f6",border:"1.5px solid #e5e7eb",borderRadius:10,color:"#111827",fontSize:14,...(p.style||{})}}/>;
const Sel=(p)=><select {...p} style={{width:"100%",padding:"10px 12px",background:"#f3f4f6",border:"1.5px solid #e5e7eb",borderRadius:10,color:"#111827",fontSize:14}}/>;
const Txa=(p)=><textarea {...p} style={{width:"100%",padding:"10px 12px",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:10,color:"#0f172a",fontSize:14,minHeight:60,resize:"vertical"}}/>;

const CSS=`
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:wght@700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes toastIn{from{opacity:0;transform:translate(-50%,-12px)}to{opacity:1;transform:translate(-50%,0)}}
  .fadeUp{animation:fadeUp .2s ease;}
  input,select,textarea,button{font-family:'Inter',sans-serif;}
  input:focus,select:focus,textarea:focus{outline:2px solid #4f46e5;outline-offset:0;border-color:transparent!important;}
  ::-webkit-scrollbar{width:4px;}
  ::-webkit-scrollbar-track{background:#f3f4f6;}
  ::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px;}
  body{background:#f9fafb;}
`;
const S={
  app:    {minHeight:"100vh",background:"#f9fafb",fontFamily:"'Inter',sans-serif",maxWidth:640,margin:"0 auto",color:"#111827"},
  toast:  {position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",color:"#fff",padding:"11px 24px",borderRadius:100,fontWeight:600,fontSize:14,zIndex:9999,boxShadow:"0 4px 20px rgba(79,70,229,.3)",whiteSpace:"nowrap",animation:"toastIn .2s ease"},
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,.3)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9000,padding:16},
  overlayTop:{position:"fixed",inset:0,background:"rgba(0,0,0,.3)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9500,padding:16},
  mbox:   {background:"#fff",borderRadius:20,padding:24,maxWidth:430,width:"100%",boxShadow:"0 20px 50px rgba(0,0,0,.12)"},
  mtitle: {color:"#111827",fontWeight:700,fontSize:17,marginBottom:4},
  msub:   {color:"#6b7280",fontSize:13,marginBottom:20},
  mbrow:  {display:"flex",gap:10},
  bghost: {flex:1,padding:"11px",background:"#f9fafb",border:"1.5px solid #e5e7eb",borderRadius:10,color:"#374151",fontWeight:600,fontSize:14,cursor:"pointer"},
  bdanger:{flex:1,padding:"11px",background:"#dc2626",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"},
  header: {background:"#fff",borderBottom:"1px solid #e5e7eb",position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 4px rgba(0,0,0,.05)"},
  htop:   {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px 8px"},
  logo:   {fontFamily:"'Playfair Display',serif",fontSize:20,color:"#111827",fontWeight:700},
  nav:    {display:"flex",gap:2,padding:"0 12px 10px"},
  nbtn:   {flex:1,padding:"8px 4px",background:"none",border:"none",borderRadius:10,fontSize:13,fontWeight:500,color:"#9ca3af",cursor:"pointer"},
  nact:   {background:"#eef2ff",color:"#4f46e5",fontWeight:700},
  main:   {padding:"14px 14px 100px"},
  g2:     {display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10},
  box:    {background:"#fff",borderRadius:16,padding:"16px",marginBottom:12,boxShadow:"0 1px 4px rgba(0,0,0,.06)"},
  bxtitle:{fontSize:11,fontWeight:700,color:"#9ca3af",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12},
  pbar:   {height:8,background:"#f3f4f6",borderRadius:100,overflow:"hidden"},
  pfill:  {height:"100%",background:"linear-gradient(90deg,#4f46e5,#7c3aed)",borderRadius:100,transition:"width .5s ease"},
  plabel: {fontSize:12,color:"#9ca3af"},
  badge:  {fontSize:11,fontWeight:600,borderRadius:6,padding:"3px 8px",display:"inline-block"},
  prow:   {display:"flex",alignItems:"center",gap:10,padding:"11px 0",borderBottom:"1px solid #f3f4f6"},
  pnome:  {fontSize:14,fontWeight:600,color:"#111827",marginBottom:2},
  pdata:  {fontSize:12,color:"#6b7280"},
  pvalor: {fontSize:14,fontWeight:700,color:"#111827"},
  empty:  {color:"#9ca3af",fontSize:13,textAlign:"center",padding:"16px 0"},
  estate: {display:"flex",flexDirection:"column",alignItems:"center",padding:"48px 16px",gap:8},
  ccard:  {background:"#fff",borderRadius:16,padding:"14px",marginBottom:8,boxShadow:"0 1px 4px rgba(0,0,0,.06)"},
  ctop:   {display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10},
  cnome:  {fontSize:14,fontWeight:600,color:"#111827",marginBottom:2},
  ccat:   {fontSize:12,color:"#6b7280"},
  cvalor: {fontSize:16,fontWeight:700,color:"#111827",fontFamily:"'Playfair Display',serif"},
  cbot:   {display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"},
  obs:    {fontSize:11,color:"#9ca3af",marginTop:8,paddingTop:8,borderTop:"1px solid #f3f4f6"},
  fab:    {position:"fixed",bottom:24,right:20,display:"flex",flexDirection:"column",gap:10,alignItems:"flex-end",zIndex:200},
  bprimary:{background:"#4f46e5",color:"#fff",border:"none",borderRadius:12,fontWeight:600,fontSize:14,padding:"10px 20px",cursor:"pointer"},
};
