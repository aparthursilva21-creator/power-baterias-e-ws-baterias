/* Power × WS — Rascunho privado de venda no Supabase (nunca é uma venda confirmada).
 * Sem localStorage/sessionStorage para dados de clientes ou valores financeiros.
 */
export const SALE_DRAFT_MINUTES = 30;
const ALLOWED_MODES = new Set(['sale','historical_sale']);

export class SaleDraftStore {
  constructor(client, ownerId) {
    if (!client || !ownerId) throw new Error('A sessão autorizada é necessária para rascunhos.');
    this.client = client;
    this.ownerId = ownerId;
    // Serializa escritas e exclusões: uma gravação atrasada não recria um rascunho vendido.
    this.tail = Promise.resolve();
  }
  queue(task) {
    const next = this.tail.catch(() => {}).then(task);
    this.tail = next;
    return next;
  }
  save(kind, formData, requestId) {
    if (!ALLOWED_MODES.has(kind) || !requestId ||
        !formData || typeof formData !== 'object' || Array.isArray(formData))
      return Promise.reject(new Error('Rascunho de venda inválido.'));
    const payload = {
      owner_id: this.ownerId,
      kind,
      form_data: { ...formData },
      request_id: requestId
    };
    return this.queue(async () => {
      const { error } = await this.client.from('pbws_sale_drafts')
        .upsert(payload,{onConflict:'owner_id,kind'});
      if (error) throw error;
    });
  }
  remove(kind) {
    if (!ALLOWED_MODES.has(kind)) return Promise.reject(new Error('Tipo de rascunho inválido.'));
    return this.queue(async () => {
      const { error } = await this.client.from('pbws_sale_drafts')
        .delete().eq('owner_id',this.ownerId).eq('kind',kind);
      if (error) throw error;
    });
  }
  removeAll() {
    return this.queue(async () => {
      const {error}=await this.client.from('pbws_sale_drafts')
        .delete().eq('owner_id',this.ownerId);
      if(error)throw error;
    });
  }
  async latest() {
    await this.tail.catch(() => {});
    const { data, error } = await this.client.from('pbws_sale_drafts')
      .select('kind,form_data,request_id,updated_at,expires_at')
      .eq('owner_id',this.ownerId)
      .order('updated_at',{ascending:false})
      .limit(2);
    if (error) throw error;
    const list = Array.isArray(data) ? data : [];
    const now = Date.now();
    // O banco também registra a expiração. Não recuperar rascunhos antigos.
    const valid=list.filter(x=>ALLOWED_MODES.has(x.kind)&&
      x.form_data && typeof x.form_data==='object' && !Array.isArray(x.form_data) &&
      typeof x.request_id==='string' && Date.parse(x.expires_at)>now);
    return valid[0]||null;
  }
}
