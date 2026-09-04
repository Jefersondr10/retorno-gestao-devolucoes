export type SystemReleaseChange = {
  title: string;
  description: string;
};

export type SystemRelease = {
  id: string;
  version: string;
  title: string;
  publishedAt: string;
  summary: string;
  changes: SystemReleaseChange[];
};

/**
 * Cada nova atualização que precisa ser apresentada aos usuários entra nesta lista.
 * O identificador não deve ser reutilizado: ele é salvo como comprovante de leitura.
 */
export const SYSTEM_RELEASES: readonly SystemRelease[] = [
  {
    id: '2026-09-03-cancelamento-e-tela-ampla',
    version: '16',
    title: 'Cancelamento seguro e gestão em tela ampla',
    publishedAt: '2026-09-03',
    summary: 'O registro pode ser cancelado com segurança e a gestão voltou a aproveitar toda a tela do computador.',
    changes: [
      { title: 'Cancelar novo registro', description: 'Use Cancelar no topo ou no rodapé. Se já houver dados ou mídias, o sistema pede confirmação antes de descartar.' },
      { title: 'Gestão em largura total', description: 'A tela de gerenciamento agora ocupa toda a área disponível, mantendo fotos e formulários bem distribuídos no desktop.' },
    ],
  },
  {
    id: '2026-09-03-produtos-tiny',
    version: '15',
    title: 'Produtos integrados ao Tiny',
    publishedAt: '2026-09-03',
    summary: 'Agora o produto pode ser localizado diretamente no catálogo do Tiny durante o recebimento ou a gestão da devolução.',
    changes: [
      { title: 'Pesquisa por nome ou SKU', description: 'Digite pelo menos duas letras para ver produtos ativos do Tiny e selecionar o item correto.' },
      { title: 'SKU preenchido automaticamente', description: 'Na gestão da devolução, ao selecionar um produto do Tiny, o SKU correspondente também é preenchido.' },
      { title: 'Preenchimento manual preservado', description: 'Se o item não estiver no Tiny ou a integração estiver indisponível, ainda é possível digitar o produto normalmente.' },
    ],
  },
  {
    id: '2026-09-03-fluxo-rapido-e-tela-cheia',
    version: '14',
    title: 'Fluxo mais rápido no celular e no computador',
    publishedAt: '2026-09-03',
    summary:
      'A gestão de devoluções ficou mais direta, com tela cheia, etapas por clique e identificação rápida no celular.',
    changes: [
      {
        title: 'Gestão em tela cheia e por etapas',
        description:
          'Ao abrir uma devolução, apenas a etapa escolhida aparece. As etapas concluídas ficam destacadas e a navegação não desloca mais a página.',
      },
      {
        title: 'Loja e local primeiro no celular',
        description:
          'Os campos de seleção aparecem antes da câmera, e cada loja mantém a cor cadastrada para facilitar a identificação.',
      },
      {
        title: 'Busca sem apagar a tela',
        description:
          'A lista permanece visível enquanto os resultados são atualizados, reduzindo a sensação de recarregamento constante.',
      },
      {
        title: 'Câmera com foco contínuo',
        description:
          'Quando o aparelho permite, a câmera interna prioriza detalhes e mantém o foco contínuo durante a captura.',
      },
    ],
  },
  {
    id: '2026-09-03-aplicativo-e-regras-de-condicao',
    version: '13',
    title: 'Aplicativo, novidades e regras mais flexíveis',
    publishedAt: '2026-09-03',
    summary:
      'O Retorno ficou mais fácil de instalar, administrar e adaptar ao processo da sua empresa.',
    changes: [
      {
        title: 'Instale o Retorno como aplicativo',
        description:
          'No celular ou computador, use a opção “Instalar aplicativo” no menu da sua conta para ter um atalho próprio e abrir o sistema em uma janela dedicada.',
      },
      {
        title: 'Novidades com confirmação de leitura',
        description:
          'Quando houver uma atualização importante, cada usuário verá este aviso ao entrar e precisará confirmar a leitura uma única vez.',
      },
      {
        title: 'Exigências por condição do produto',
        description:
          'Agora é possível editar cada condição e decidir separadamente se ela exige nota de entrada e se exige o preenchimento das condições encontradas.',
      },
      {
        title: 'Usuários com acessos personalizados',
        description:
          'O administrador pode criar usuários e selecionar, por caixas de marcação, exatamente quais áreas e ações cada pessoa poderá utilizar.',
      },
    ],
  },
];

export function isKnownReleaseId(value: string) {
  return SYSTEM_RELEASES.some((release) => release.id === value);
}
