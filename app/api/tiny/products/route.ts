import { env } from 'cloudflare:workers';

import { authenticateApi } from '@/lib/auth';
import { apiError } from '@/lib/data';

export const dynamic = 'force-dynamic';

type TinyEnvironment = { TINY_API_TOKEN?: string };
type TinyProduct = { id?: number | string; nome?: string; codigo?: string; gtin?: string; situacao?: string };

export async function GET(request: Request) {
  try {
    const auth = await authenticateApi(request, { anyPermissions: ['returns.view', 'returns.create', 'returns.edit'], csrf: false });
    if ('response' in auth) return auth.response;
    const query = new URL(request.url).searchParams.get('q')?.trim() || '';
    if (query.length < 2) return Response.json({ items: [] });

    const token = (env as unknown as TinyEnvironment).TINY_API_TOKEN;
    if (!token) return apiError('A integração com o Tiny ainda não foi configurada.', 503);

    const body = new URLSearchParams({ token, formato: 'json', pesquisa: query, situacao: 'A', pagina: '1' });
    const response = await fetch('https://api.tiny.com.br/api2/produtos.pesquisa.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
    });
    if (!response.ok) return apiError('O Tiny não respondeu à pesquisa de produtos.', 502);
    const payload = (await response.json()) as { retorno?: { status?: string; produtos?: Array<{ produto?: TinyProduct }>; erros?: Array<{ erro?: string }> } };
    if (payload.retorno?.status !== 'OK') {
      const message = payload.retorno?.erros?.[0]?.erro || 'Não foi possível pesquisar os produtos no Tiny.';
      return apiError(message, 502);
    }

    const items = (payload.retorno.produtos || []).slice(0, 20).map(({ produto }) => ({
      id: String(produto?.id || ''),
      name: produto?.nome?.trim() || '',
      sku: produto?.codigo?.trim() || '',
      gtin: produto?.gtin?.trim() || '',
    })).filter((product) => product.name);
    return Response.json({ items }, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível pesquisar os produtos no Tiny.', 500);
  }
}
