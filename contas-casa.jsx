import { useState, useEffect, useCallback } from "react";

// ─── UTILS ───────────────────────────────────────────────────
const fmtBRL = (v) => Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const fmtDate = (s) => { if(!s) return "-"; const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; };
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2);
const mesAtualStr = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const hoje0 = () => { const d=new Date(); d.setHours(0,0,0,0); return d; };
const daysUntil = (s) => Math.round((new Date(s+"T00:00:00")-hoje0())/864e5);
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

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

function getStatusConta(c){
  if(c.pago) return "pago";
  const d=daysUntil(c.vencimento);
  return d<0?"vencido":"pendente";
}

const ST = {
  pago:     {label:"Pago",     cor:"#10b981", bg:"#10b98122"},
  pendente: {label:"Pendente", cor:"#f59e0b", bg:"#f59e0b22"},
  vencido:  {label:"Vencido",  cor:"#ef4444", bg:"#ef444422"},
};

const EMPTY_CONTA  = {nome:"",categoria:"moradia",valor:"",vencimento:"",pago:false,recorrente:false,obs:""};
const EMPTY_CARTAO = {nome:"",bandeira:"nubank",limite:"",obs:""};
const EMPTY_COMPRA = {cartaoId:"",descricao:"",valor:"",totalParcelas:"1",parcelaAtual:"1",mes:"",obs:""};

// ─── APP ─────────────────────────────────────────────────────
export default function App() {
  const [tab,       setTab]      = useState("dashboard");
  const [contas,    setContas]   = useState([]);   // contas fixas
  const [cartoes,   setCartoes]  = useState([]);   // cartões cadastrados
  const [compras,   setCompras]  = useState([]);   // compras dos cartões
  const [loading,   setLoading]  = useState(true);
  const [toast,     setToast]    = useState(null);
  const [modal,     setModal]    = useState(null); // {type:"conta"|"cartao"|"compra"|"verCartao", data}
  const [confirm,   setConfirm]  = useState(null);
  const [filtroMes, setFiltroMes]= useState(mesAtualStr);

  // ── Storage ──
  useEffect(()=>{
    (async()=>{
      try {
        const r1=await window.storage.get("cc2-contas");   if(r1) setContas(JSON.parse(r1.value));
        const r2=await window.storage.get("cc2-cartoes");  if(r2) setCartoes(JSON.parse(r2.value));
        const r3=await window.storage.get("cc2-compras");  if(r3) setCompras(JSON.parse(r3.value));
      } catch(e){}
      setLoading(false);
    })();
  },[]);

  const persist = useCallback(async(key,val)=>{ try{ await window.storage.set(key,JSON.stringify(val)); }catch(e){} },[]);

  const toast_ = (msg,type="ok")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),2800); };

  // ── CONTAS FIXAS ──
  async function saveConta(form){
    if(!form.nome.trim()||!form.valor||!form.vencimento){ toast_("Preencha nome, valor e vencimento","err"); return; }
    let next;
    if(form.id){ next=contas.map(c=>c.id===form.id?form:c); toast_("Conta atualizada!"); }
    else        { next=[...contas,{...form,id:uid()}];       toast_("Conta adicionada!"); }
    setContas(next); await persist("cc2-contas",next); setModal(null);
  }
  async function deleteConta(id){
    const next=contas.filter(c=>c.id!==id); setContas(next); await persist("cc2-contas",next);
    setConfirm(null); toast_("Removido");
  }
  async function togglePago(c,isFatura=false){
    if(isFatura){
      // marca fatura do cartão como paga — adiciona flag no cartao p/ aquele mês
      const key=`${c.cartaoId}_${filtroMes}`;
      const next=cartoes.map(k=>k.id===c.cartaoId?{...k,faturasPagas:{...(k.faturasPagas||{}),[filtroMes]:!(k.faturasPagas||{})[filtroMes]}}:k);
      setCartoes(next); await persist("cc2-cartoes",next);
      toast_(!((cartoes.find(k=>k.id===c.cartaoId)?.faturasPagas||{})[filtroMes])?"Fatura marcada como paga ✓":"Fatura desmarcada");
    } else {
      const next=contas.map(x=>x.id===c.id?{...x,pago:!x.pago}:x);
      setContas(next); await persist("cc2-contas",next);
      toast_(c.pago?"Desmarcado":"Marcado como pago ✓");
    }
  }

  // ── CARTÕES ──
  async function saveCartao(form){
    if(!form.nome.trim()){ toast_("Informe o nome do cartão","err"); return; }
    let next;
    if(form.id){ next=cartoes.map(c=>c.id===form.id?form:c); toast_("Cartão atualizado!"); }
    else        { next=[...cartoes,{...form,id:uid()}];       toast_("Cartão adicionado!"); }
    setCartoes(next); await persist("cc2-cartoes",next); setModal(null);
  }
  async function deleteCartao(id){
    const nextC=cartoes.filter(c=>c.id!==id);
    const nextP=compras.filter(c=>c.cartaoId!==id);
    setCartoes(nextC); setCompras(nextP);
    await persist("cc2-cartoes",nextC); await persist("cc2-compras",nextP);
    setConfirm(null); toast_("Cartão removido");
  }

  // ── COMPRAS ──
  async function saveCompra(form){
    if(!form.cartaoId||!form.descricao.trim()||!form.valor||!form.mes){ toast_("Preencha todos os campos obrigatórios","err"); return; }
    let next;
    if(form.id){ next=compras.map(c=>c.id===form.id?form:c); toast_("Compra atualizada!"); }
    else        { next=[...compras,{...form,id:uid()}];       toast_("Compra adicionada!"); }
    setCompras(next); await persist("cc2-compras",next); setModal(null);
  }
  async function deleteCompra(id){
    const next=compras.filter(c=>c.id!==id); setCompras(next); await persist("cc2-compras",next);
    setConfirm(null); toast_("Compra removida");
  }

  // ── COMPUTED ──
  // Compras do mês atual selecionado, agrupadas por cartão
  function faturaCartao(cartaoId, mes){
    return compras.filter(c=>c.cartaoId===cartaoId && c.mes===mes).reduce((s,c)=>s+Number(c.valor),0);
  }

  // "Linhas de fatura" — cada cartão que tiver compras no mês vira uma linha de conta
  const faturas = cartoes
    .map(cartao=>{
      const total = faturaCartao(cartao.id, filtroMes);
      if(total===0) return null;
      const pago = (cartao.faturasPagas||{})[filtroMes]||false;
      const ban = BANDEIRAS.find(b=>b.id===cartao.bandeira)||BANDEIRAS[6];
      return { _fatura:true, cartaoId:cartao.id, nome:`Fatura ${cartao.nome}`, valor:total, pago, cor:ban.cor, icon:ban.icon, bandLabel:ban.label };
    })
    .filter(Boolean);

  const contasMes = contas.filter(c=>{
    if(!c.vencimento) return false;
    const [y,m]=filtroMes.split("-");
    return c.vencimento.startsWith(`${y}-${m}`);
  });

  const contasRS = contasMes.map(c=>({...c,status:getStatusConta(c)}));

  // Lista combinada para exibição na aba Contas
  const todasLinhas = [
    ...contasRS,
    ...faturas.map(f=>({...f, status: f.pago?"pago":"pendente"}))
  ];

  const totalFixas = contasRS.reduce((s,c)=>s+Number(c.valor),0);
  const pagoFixas  = contasRS.filter(c=>c.status==="pago").reduce((s,c)=>s+Number(c.valor),0);
  const totalFaturas= faturas.reduce((s,f)=>s+f.valor,0);
  const pagoFaturas = faturas.filter(f=>f.pago).reduce((s,f)=>s+f.valor,0);
  const totalGeral  = totalFixas+totalFaturas;
  const totalPago   = pagoFixas+pagoFaturas;

  const vencidoQty= contasRS.filter(c=>c.status==="vencido").length;
  const pendQty   = todasLinhas.filter(c=>c.status==="pendente"||c.status==="vencido").length;

  const proximas = todasLinhas
    .filter(c=>c.status!=="pago")
    .sort((a,b)=>{ if(a._fatura&&!b._fatura) return 1; if(!a._fatura&&b._fatura) return -1; return new Date(a.vencimento)-new Date(b.vencimento); })
    .slice(0,6);

  if(loading) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#0f172a"}}>
      <div style={{width:40,height:40,border:"3px solid #334155",borderTop:"3px solid #38bdf8",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={S.app}>
      <style>{CSS}</style>

      {toast&&<div style={{...S.toast,background:toast.type==="err"?"#ef4444":"#10b981"}}>{toast.type==="err"?"⚠️":"✓"} {toast.msg}</div>}

      {confirm&&(
        <div style={S.overlay} onClick={()=>setConfirm(null)}>
          <div style={S.mbox} onClick={e=>e.stopPropagation()}>
            <p style={S.mtitle}>Confirmar exclusão</p>
            <p style={S.msub}>"{confirm.nome||confirm.descricao}" será removido permanentemente.</p>
            <div style={S.mbrow}>
              <button style={S.bghost} onClick={()=>setConfirm(null)}>Cancelar</button>
              <button style={S.bdanger} onClick={()=>{
                if(confirm._type==="cartao")  deleteCartao(confirm.id);
                else if(confirm._type==="compra") deleteCompra(confirm.id);
                else deleteConta(confirm.id);
              }}>Excluir</button>
            </div>
          </div>
        </div>
      )}

      {modal&&(
        <div style={S.overlay} onClick={()=>setModal(null)}>
          <div style={{...S.mbox,maxHeight:"92vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            {modal.type==="conta"   && <FormConta   data={modal.data} filtroMes={filtroMes} onSave={saveConta}  onClose={()=>setModal(null)}/>}
            {modal.type==="cartao"  && <FormCartao  data={modal.data}                        onSave={saveCartao} onClose={()=>setModal(null)}/>}
            {modal.type==="compra"  && <FormCompra  data={modal.data} cartoes={cartoes} filtroMes={filtroMes} onSave={saveCompra} onClose={()=>setModal(null)}/>}
            {modal.type==="verCartao" && (
              <VerCartao
                cartao={modal.data}
                compras={compras}
                filtroMes={filtroMes}
                onNovaCompra={()=>setModal({type:"compra",data:{cartaoId:modal.data.id,mes:filtroMes}})}
                onEditCompra={c=>setModal({type:"compra",data:c})}
                onDelCompra={c=>setConfirm({...c,_type:"compra"})}
                onEditCartao={()=>setModal({type:"cartao",data:modal.data})}
                onDelCartao={()=>setConfirm({...modal.data,_type:"cartao"})}
              />
            )}
          </div>
        </div>
      )}

      {/* HEADER */}
      <header style={S.header}>
        <div style={S.htop}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={S.logo}>💰 CasaConta</span>
            <MesPicker value={filtroMes} onChange={setFiltroMes}/>
          </div>
        </div>
        <nav style={S.nav}>
          {[["dashboard","📊 Resumo"],["contas","📋 Contas"],["cartoes","💳 Cartões"]].map(([v,l])=>(
            <button key={v} style={{...S.nbtn,...(tab===v?S.nact:{})}} onClick={()=>setTab(v)}>{l}</button>
          ))}
        </nav>
      </header>

      <main style={S.main}>

        {/* ═══ DASHBOARD ═══ */}
        {tab==="dashboard"&&(
          <div className="fadeUp">
            <div style={S.g2} >
              <BigCard label="Total do mês" value={fmtBRL(totalGeral)} sub={`${todasLinhas.length} lançamentos`} cor="#38bdf8"/>
              <BigCard label="Total pago"   value={fmtBRL(totalPago)}  sub={`${Math.round(totalGeral>0?(totalPago/totalGeral)*100:0)}% quitado`} cor="#10b981"/>
            </div>
            <div style={S.g2}>
              <BigCard label="Contas fixas"  value={fmtBRL(totalFixas)}   sub={`${contasRS.length} conta${contasRS.length!==1?"s":""}`}   cor="#818cf8"/>
              <BigCard label="Faturas cartão" value={fmtBRL(totalFaturas)} sub={`${faturas.length} cartão${faturas.length!==1?"ões":""}`}  cor="#f472b6"/>
            </div>

            {/* Barra */}
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

            {/* Pendentes */}
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
                          <span style={{...S.badge,background:"#f472b622",color:"#f472b6"}}>Fatura</span>
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
                        <p style={S.pnome}>{c.nome}</p>
                        <p style={S.pdata}>{fmtDate(c.vencimento)}</p>
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

            {/* Cartões resumo */}
            {cartoes.length>0&&(
              <div style={S.box}>
                <p style={S.bxtitle}>Faturas deste mês</p>
                {cartoes.map(cartao=>{
                  const tot=faturaCartao(cartao.id,filtroMes);
                  const ban=BANDEIRAS.find(b=>b.id===cartao.bandeira)||BANDEIRAS[6];
                  const pago=(cartao.faturasPagas||{})[filtroMes]||false;
                  return(
                    <div key={cartao.id} style={{...S.prow,cursor:"pointer"}} onClick={()=>setModal({type:"verCartao",data:cartao})}>
                      <div style={{width:36,height:36,borderRadius:10,background:ban.cor+"33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{ban.icon}</div>
                      <div style={{flex:1}}>
                        <p style={S.pnome}>{cartao.nome}</p>
                        <p style={S.pdata}>{compras.filter(c=>c.cartaoId===cartao.id&&c.mes===filtroMes).length} compra{compras.filter(c=>c.cartaoId===cartao.id&&c.mes===filtroMes).length!==1?"s":""}</p>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <p style={S.pvalor}>{fmtBRL(tot)}</p>
                        <span style={{...S.badge,background:pago?"#10b98122":"#f472b622",color:pago?"#10b981":"#f472b6"}}>{pago?"Pago":"Aberta"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {todasLinhas.length===0&&cartoes.length===0&&(
              <div style={S.estate}>
                <div style={{fontSize:52,marginBottom:10}}>🏠</div>
                <p style={{color:"#f1f5f9",fontWeight:700,fontSize:20,fontFamily:"'Playfair Display',serif",marginBottom:6}}>Comece agora!</p>
                <p style={{color:"#64748b",fontSize:13,marginBottom:20,textAlign:"center"}}>Adicione contas fixas e cadastre seus cartões</p>
                <div style={{display:"flex",gap:10}}>
                  <button style={S.bprimary} onClick={()=>setModal({type:"conta",data:null})}>+ Conta</button>
                  <button style={{...S.bprimary,background:"linear-gradient(135deg,#f472b6,#818cf8)"}} onClick={()=>setModal({type:"cartao",data:null})}>+ Cartão</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ CONTAS ═══ */}
        {tab==="contas"&&(
          <div className="fadeUp">
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
              <button style={S.bprimary} onClick={()=>setModal({type:"conta",data:null})}>+ Nova conta</button>
            </div>

            {/* Faturas como linhas */}
            {faturas.length>0&&(
              <div style={{marginBottom:16}}>
                <p style={{...S.bxtitle,marginBottom:8,color:"#f472b6"}}>💳 Faturas de cartão</p>
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
                        <span style={{...S.badge,background:f.pago?"#10b98122":"#f472b622",color:f.pago?"#10b981":"#f472b6",border:`1px solid ${f.pago?"#10b98144":"#f472b644"}`}}>
                          {f.pago?"Paga":"Em aberto"}
                        </span>
                        <div style={{flex:1}}/>
                        <Btn bg={f.pago?"#1e293b":"#052e16"} color={f.pago?"#64748b":"#10b981"} onClick={()=>togglePago(f,true)}>{f.pago?"↩ Desmarcar":"✓ Pagar"}</Btn>
                        <Btn bg="#1e293b" color="#94a3b8" onClick={()=>setModal({type:"verCartao",data:cartoes.find(c=>c.id===f.cartaoId)})}>Ver detalhes</Btn>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Contas fixas */}
            {contasRS.length>0&&<p style={{...S.bxtitle,marginBottom:8,color:"#818cf8"}}>📋 Contas fixas</p>}
            {contasRS.sort((a,b)=>new Date(a.vencimento)-new Date(b.vencimento)).map(c=>{
              const cat=CATS.find(x=>x.id===c.categoria);
              const st=ST[c.status];
              const d=daysUntil(c.vencimento);
              return(
                <div key={c.id} style={S.ccard}>
                  <div style={S.ctop}>
                    <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                      <span style={{fontSize:22}}>{cat?.icon}</span>
                      <div>
                        <p style={S.cnome}>{c.nome}</p>
                        <p style={S.ccat}>{cat?.label}{c.recorrente?" · 🔁":""}</p>
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
                    <Btn bg={c.status==="pago"?"#1e293b":"#052e16"} color={c.status==="pago"?"#64748b":"#10b981"} onClick={()=>togglePago(c)}>{c.status==="pago"?"↩":"✓"}</Btn>
                    <Btn bg="#1e3a5f" color="#38bdf8" onClick={()=>setModal({type:"conta",data:c})}>✏️</Btn>
                    <Btn bg="#450a0a" color="#ef4444" onClick={()=>setConfirm({...c,_type:"conta"})}>🗑</Btn>
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

        {/* ═══ CARTÕES ═══ */}
        {tab==="cartoes"&&(
          <div className="fadeUp">
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
              <button style={{...S.bprimary,background:"linear-gradient(135deg,#f472b6,#818cf8)"}} onClick={()=>setModal({type:"cartao",data:null})}>+ Novo cartão</button>
            </div>

            {cartoes.length===0&&(
              <div style={S.estate}>
                <div style={{fontSize:48,marginBottom:10}}>💳</div>
                <p style={{color:"#94a3b8",marginBottom:16}}>Nenhum cartão cadastrado</p>
                <button style={{...S.bprimary,background:"linear-gradient(135deg,#f472b6,#818cf8)"}} onClick={()=>setModal({type:"cartao",data:null})}>Adicionar cartão</button>
              </div>
            )}

            {cartoes.map(cartao=>{
              const ban=BANDEIRAS.find(b=>b.id===cartao.bandeira)||BANDEIRAS[6];
              const totMes=faturaCartao(cartao.id,filtroMes);
              const totCompras=compras.filter(c=>c.cartaoId===cartao.id).length;
              const pago=(cartao.faturasPagas||{})[filtroMes]||false;
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
                    <span style={{...S.badge,background:pago?"#10b98122":"#f472b622",color:pago?"#10b981":"#f472b6"}}>
                      {pago?"Fatura paga":"Fatura aberta"}
                    </span>
                    {cartao.limite&&<span style={{...S.badge,background:"#1e293b",color:"#64748b"}}>Limite: {fmtBRL(cartao.limite)}</span>}
                    <div style={{flex:1}}/>
                    <Btn bg="#1e3a5f" color="#38bdf8" onClick={e=>{e.stopPropagation();setModal({type:"cartao",data:cartao})}}>✏️</Btn>
                    <Btn bg="#450a0a" color="#ef4444" onClick={e=>{e.stopPropagation();setConfirm({...cartao,_type:"cartao"})}}>🗑</Btn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* FAB */}
      <div style={S.fab}>
        {tab==="cartoes"&&<FabBtn label="+ Compra" onClick={()=>setModal({type:"compra",data:null})} bg="linear-gradient(135deg,#f472b6,#818cf8)"/>}
        {tab==="contas"&&<FabBtn label="+ Conta"  onClick={()=>setModal({type:"conta",data:null})}/>}
        {tab==="dashboard"&&<>
          <FabBtn label="+ Conta"  onClick={()=>setModal({type:"conta",data:null})}/>
          <FabBtn label="+ Cartão" onClick={()=>setModal({type:"cartao",data:null})} bg="linear-gradient(135deg,#f472b6,#818cf8)"/>
        </>}
      </div>
    </div>
  );
}

// ─── MODAL: VER CARTÃO ────────────────────────────────────────
function VerCartao({cartao,compras,filtroMes,onNovaCompra,onEditCompra,onDelCompra,onEditCartao,onDelCartao}){
  const ban=BANDEIRAS.find(b=>b.id===cartao.bandeira)||BANDEIRAS[6];
  const comprasMes=compras.filter(c=>c.cartaoId===cartao.id&&c.mes===filtroMes);
  const total=comprasMes.reduce((s,c)=>s+Number(c.valor),0);
  const [mesSel,setMesSel]=useState(filtroMes);
  const comprasSel=compras.filter(c=>c.cartaoId===cartao.id&&c.mes===mesSel);
  const totalSel=comprasSel.reduce((s,c)=>s+Number(c.valor),0);

  return(
    <div>
      {/* cabeçalho cartão */}
      <div style={{background:ban.cor+"22",borderRadius:12,padding:"16px",marginBottom:16,display:"flex",gap:14,alignItems:"center"}}>
        <div style={{width:50,height:50,borderRadius:14,background:ban.cor+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>{ban.icon}</div>
        <div style={{flex:1}}>
          <p style={{color:"#f1f5f9",fontWeight:700,fontSize:18,fontFamily:"'Playfair Display',serif"}}>{cartao.nome}</p>
          <p style={{color:"#94a3b8",fontSize:13}}>{ban.label}{cartao.limite?` · Limite ${fmtBRL(cartao.limite)}`:""}</p>
        </div>
        <div style={{display:"flex",gap:6}}>
          <Btn bg="#1e3a5f" color="#38bdf8" onClick={onEditCartao}>✏️</Btn>
          <Btn bg="#450a0a" color="#ef4444" onClick={onDelCartao}>🗑</Btn>
        </div>
      </div>

      {/* seletor de mês */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <MesPicker value={mesSel} onChange={setMesSel}/>
        <span style={{color:"#f1f5f9",fontWeight:700,fontSize:16}}>{fmtBRL(totalSel)}</span>
      </div>

      {comprasSel.length===0
        ?<p style={{color:"#475569",fontSize:13,textAlign:"center",padding:"16px 0"}}>Nenhuma compra neste mês</p>
        :comprasSel.map(c=>(
          <div key={c.id} style={{background:"#0f172a",borderRadius:10,padding:"12px",marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
            <div style={{flex:1}}>
              <p style={{color:"#f1f5f9",fontWeight:600,fontSize:14}}>{c.descricao}</p>
              {Number(c.totalParcelas)>1&&<p style={{color:"#64748b",fontSize:12}}>Parcela {c.parcelaAtual}/{c.totalParcelas}</p>}
              {c.obs&&<p style={{color:"#475569",fontSize:11,marginTop:2}}>💬 {c.obs}</p>}
            </div>
            <div style={{textAlign:"right"}}>
              <p style={{color:"#f1f5f9",fontWeight:700,fontSize:15}}>{fmtBRL(c.valor)}</p>
              <div style={{display:"flex",gap:4,justifyContent:"flex-end",marginTop:4}}>
                <Btn bg="#1e3a5f" color="#38bdf8" onClick={()=>onEditCompra(c)}>✏️</Btn>
                <Btn bg="#450a0a" color="#ef4444" onClick={()=>onDelCompra(c)}>🗑</Btn>
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
        <input type="checkbox" id="rec" checked={!!f.recorrente} onChange={e=>s("recorrente",e.target.checked)} style={{width:16,height:16,accentColor:"#38bdf8"}}/>
        <label htmlFor="rec" style={{color:"#94a3b8",fontSize:14}}>🔁 Recorrente (mensal)</label>
      </div>
      <Lbl>Observação</Lbl><Txa placeholder="Opcional..." value={f.obs} onChange={e=>s("obs",e.target.value)}/>
      <button style={{...S.bprimary,width:"100%",marginTop:18,padding:"13px"}} onClick={()=>onSave(f)}>
        {f.id?"Salvar":"Adicionar conta"}
      </button>
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
      <Lbl>Limite (R$) — opcional</Lbl><Inp type="number" placeholder="0,00" value={f.limite} onChange={e=>s("limite",e.target.value)}/>
      <Lbl>Observação</Lbl><Txa placeholder="Opcional..." value={f.obs} onChange={e=>s("obs",e.target.value)}/>
      <button style={{...S.bprimary,width:"100%",marginTop:18,padding:"13px",background:"linear-gradient(135deg,#f472b6,#818cf8)"}} onClick={()=>onSave(f)}>
        {f.id?"Salvar":"Adicionar cartão"}
      </button>
    </div>
  );
}

function FormCompra({data,cartoes,filtroMes,onSave,onClose}){
  const [f,setF]=useState(data||{...EMPTY_COMPRA,cartaoId:cartoes[0]?.id||"",mes:filtroMes});
  const s=(k,v)=>setF(x=>({...x,[k]:v}));
  return(
    <div>
      <FHeader title={f.id?"Editar Compra":"Nova Compra"} onClose={onClose}/>
      <Lbl>Cartão *</Lbl>
      <Sel value={f.cartaoId} onChange={e=>s("cartaoId",e.target.value)}>
        {cartoes.length===0&&<option value="">Nenhum cartão cadastrado</option>}
        {cartoes.map(c=>{ const b=BANDEIRAS.find(x=>x.id===c.bandeira)||BANDEIRAS[6]; return <option key={c.id} value={c.id}>{b.icon} {c.nome}</option>; })}
      </Sel>
      <Lbl>Mês de referência *</Lbl><Inp type="month" value={f.mes} onChange={e=>s("mes",e.target.value)}/>
      <Lbl>Descrição *</Lbl><Inp placeholder="Ex: Supermercado" value={f.descricao} onChange={e=>s("descricao",e.target.value)}/>
      <Lbl>Valor da parcela (R$) *</Lbl><Inp type="number" placeholder="0,00" value={f.valor} onChange={e=>s("valor",e.target.value)}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div><Lbl>Parcela atual</Lbl><Inp type="number" min="1" value={f.parcelaAtual} onChange={e=>s("parcelaAtual",e.target.value)}/></div>
        <div><Lbl>Total parcelas</Lbl><Inp type="number" min="1" value={f.totalParcelas} onChange={e=>s("totalParcelas",e.target.value)}/></div>
      </div>
      <Lbl>Observação</Lbl><Txa placeholder="Opcional..." value={f.obs} onChange={e=>s("obs",e.target.value)}/>
      <button style={{...S.bprimary,width:"100%",marginTop:18,padding:"13px",background:"linear-gradient(135deg,#f472b6,#818cf8)"}} onClick={()=>onSave(f)}>
        {f.id?"Salvar":"Adicionar compra"}
      </button>
    </div>
  );
}

// ─── MINI COMPONENTS ─────────────────────────────────────────
function BigCard({label,value,sub,cor}){
  return(
    <div style={{background:"#1e293b",borderRadius:14,padding:"16px",borderLeft:`3px solid ${cor}`}}>
      <p style={{fontSize:11,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>{label}</p>
      <p style={{fontSize:19,fontWeight:700,color:"#f1f5f9",fontFamily:"'Playfair Display',serif",marginBottom:2}}>{value}</p>
      <p style={{fontSize:11,color:"#475569"}}>{sub}</p>
    </div>
  );
}
function Btn({bg,color,onClick,children}){
  return <button style={{background:bg,color,border:"none",borderRadius:8,padding:"6px 10px",fontSize:13,fontWeight:700,whiteSpace:"nowrap"}} onClick={onClick}>{children}</button>;
}
function FabBtn({label,onClick,bg="linear-gradient(135deg,#38bdf8,#818cf8)"}){
  return <button style={{background:bg,color:"#fff",border:"none",borderRadius:100,padding:"10px 20px",fontWeight:700,fontSize:14,boxShadow:"0 4px 20px rgba(0,0,0,.4)"}} onClick={onClick}>{label}</button>;
}
function MesPicker({value,onChange}){
  const [y,m]=value.split("-").map(Number);
  const prev=()=>{ let nm=m-1,ny=y; if(nm<1){nm=12;ny--;} onChange(`${ny}-${String(nm).padStart(2,"0")}`); };
  const next=()=>{ let nm=m+1,ny=y; if(nm>12){nm=1;ny++;} onChange(`${ny}-${String(nm).padStart(2,"0")}`); };
  return(
    <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
      <button style={{background:"#1e293b",border:"none",color:"#94a3b8",fontSize:16,width:28,height:28,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={prev}>‹</button>
      <span style={{fontSize:13,color:"#94a3b8",textTransform:"capitalize",minWidth:70,textAlign:"center"}}>{MESES[m-1]} {y}</span>
      <button style={{background:"#1e293b",border:"none",color:"#94a3b8",fontSize:16,width:28,height:28,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={next}>›</button>
    </span>
  );
}
function FHeader({title,onClose}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
      <h2 style={{color:"#f1f5f9",fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700}}>{title}</h2>
      <button style={{background:"none",border:"none",color:"#64748b",fontSize:20,lineHeight:1}} onClick={onClose}>✕</button>
    </div>
  );
}
const Lbl=({children})=><label style={{display:"block",fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.06em",marginTop:14,marginBottom:5}}>{children}</label>;
const Inp=(p)=><input {...p} style={{width:"100%",padding:"10px 12px",background:"#0f172a",border:"1.5px solid #334155",borderRadius:10,color:"#f1f5f9",fontSize:14,...(p.style||{})}}/>;
const Sel=(p)=><select {...p} style={{width:"100%",padding:"10px 12px",background:"#0f172a",border:"1.5px solid #334155",borderRadius:10,color:"#f1f5f9",fontSize:14}}/>;
const Txa=(p)=><textarea {...p} style={{width:"100%",padding:"10px 12px",background:"#0f172a",border:"1.5px solid #334155",borderRadius:10,color:"#f1f5f9",fontSize:14,minHeight:60,resize:"vertical"}}/>;

// ─── STYLES ──────────────────────────────────────────────────
const CSS=`
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes toastIn{from{opacity:0;transform:translate(-50%,-16px)}to{opacity:1;transform:translate(-50%,0)}}
  .fadeUp{animation:fadeUp .22s ease;}
  input,select,textarea{font-family:'DM Sans',sans-serif;}
  input:focus,select:focus,textarea:focus{outline:2px solid #38bdf8;border-color:transparent!important;}
  button{cursor:pointer;font-family:'DM Sans',sans-serif;}
  ::-webkit-scrollbar{width:4px;height:4px;}
  ::-webkit-scrollbar-track{background:#1e293b;}
  ::-webkit-scrollbar-thumb{background:#475569;border-radius:4px;}
`;
const S={
  app:   {minHeight:"100vh",background:"#0f172a",fontFamily:"'DM Sans',sans-serif",maxWidth:640,margin:"0 auto",color:"#f1f5f9"},
  toast: {position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",color:"#fff",padding:"10px 22px",borderRadius:100,fontWeight:600,fontSize:14,zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,.5)",whiteSpace:"nowrap",animation:"toastIn .25s ease"},
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9000,padding:16},
  mbox:  {background:"#1e293b",borderRadius:18,padding:22,maxWidth:430,width:"100%",boxShadow:"0 25px 60px rgba(0,0,0,.6)"},
  mtitle:{color:"#f1f5f9",fontWeight:700,fontSize:17,marginBottom:4},
  msub:  {color:"#64748b",fontSize:13,marginBottom:20},
  mbrow: {display:"flex",gap:10},
  bghost:{flex:1,padding:"11px",background:"#0f172a",border:"1px solid #334155",borderRadius:10,color:"#94a3b8",fontWeight:600,fontSize:14},
  bdanger:{flex:1,padding:"11px",background:"#ef4444",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14},
  header:{background:"#1e293b",borderBottom:"1px solid #334155",position:"sticky",top:0,zIndex:100},
  htop:  {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px 8px"},
  logo:  {fontFamily:"'Playfair Display',serif",fontSize:20,color:"#f1f5f9",fontWeight:700},
  nav:   {display:"flex",gap:2,padding:"0 12px 10px"},
  nbtn:  {flex:1,padding:"8px 4px",background:"none",border:"none",borderRadius:10,fontSize:13,fontWeight:500,color:"#64748b"},
  nact:  {background:"#0f172a",color:"#38bdf8",fontWeight:700},
  main:  {padding:"14px 14px 100px"},
  g2:    {display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10},
  box:   {background:"#1e293b",borderRadius:16,padding:"16px",marginBottom:12},
  bxtitle:{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10},
  pbar:  {height:8,background:"#0f172a",borderRadius:100,overflow:"hidden"},
  pfill: {height:"100%",background:"linear-gradient(90deg,#38bdf8,#818cf8)",borderRadius:100,transition:"width .5s ease"},
  plabel:{fontSize:12,color:"#64748b"},
  badge: {fontSize:11,fontWeight:700,borderRadius:6,padding:"2px 8px",display:"inline-block"},
  prow:  {display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #0f172a"},
  pnome: {fontSize:14,fontWeight:600,color:"#f1f5f9",marginBottom:1},
  pdata: {fontSize:12,color:"#64748b"},
  pvalor:{fontSize:14,fontWeight:700,color:"#f1f5f9"},
  empty: {color:"#475569",fontSize:13,textAlign:"center",padding:"12px 0"},
  estate:{display:"flex",flexDirection:"column",alignItems:"center",padding:"48px 16px",gap:8},
  ccard: {background:"#1e293b",borderRadius:14,padding:"14px",marginBottom:8},
  ctop:  {display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10},
  cnome: {fontSize:14,fontWeight:600,color:"#f1f5f9",marginBottom:2},
  ccat:  {fontSize:12,color:"#64748b"},
  cvalor:{fontSize:16,fontWeight:700,color:"#f1f5f9",fontFamily:"'Playfair Display',serif"},
  cbot:  {display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"},
  obs:   {fontSize:11,color:"#475569",marginTop:8,paddingTop:8,borderTop:"1px solid #0f172a"},
  fab:   {position:"fixed",bottom:24,right:20,display:"flex",flexDirection:"column",gap:10,alignItems:"flex-end",zIndex:200},
  bprimary:{background:"linear-gradient(135deg,#38bdf8,#818cf8)",color:"#0f172a",border:"none",borderRadius:12,fontWeight:700,fontSize:14,padding:"10px 20px"},
};
