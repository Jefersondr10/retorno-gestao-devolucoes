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
