*Esta tradução é um rascunho: nenhum falante nativo a revisou ainda. Encontrou um erro? [Sugira uma correção](https://github.com/PiwiTests/platform/issues/new?template=translation.yml).*

O Piwi Picker encontra o locator a usar para qualquer elemento da página em que você está. Cada candidato é classificado pela estabilidade e depois contado na página como ela está, para que o primeiro corresponda a um único elemento. A extensão também transforma um percurso que você faz clicando, em várias páginas, em um teste Playwright pronto para rodar.

**As ferramentas, direto na página**

- **Escolher elemento**: os locators classificados de um elemento, conferidos na página, para copiar sozinhos, como linha de ação ou como asserção.
- **Inspecionar**: o melhor locator do elemento sob o mouse.
- **Console**: digite um locator e veja o que ele encontra agora, com o veredito do modo estrito.
- **Multisseleção**: o padrão comum às linhas ou aos cartões de uma lista.
- **Verificação**: os elementos difíceis de localizar em um teste, cada um com um data-testid sugerido.
- **Asserções**: linhas expect(...) para um elemento.
- **Sessão**: elementos que você nomeia em várias páginas, exportados como page object, tabela Markdown ou JSON.
- **Contexto de IA**: um bloco que descreve um elemento, para entregar a um agente de código.
- **Gravar**: cliques, digitação e escolhas nas páginas de um site, transformados em um teste TypeScript. As senhas nunca são gravadas.

**Privado por padrão**

Escolher e gravar nunca usam a rede. Nada é coletado nem enviado.

**Opcional: conectar sua própria instância do Piwi**

O Piwi é um painel auto-hospedado para os resultados de testes Playwright. Com a extensão conectada à sua instância (o endereço dela e uma chave de API, nas configurações), três ferramentas se somam: gravações que chamam suas próprias funções de teste, **Funções de teste**, que mostra quais delas funcionam na página, e **Elementos testados**, que destaca os elementos que seus testes alcançam. A extensão só lê a sua instância; uma gravação nunca é enviada para ela.

**Permissões**

- A aba que você está vendo, só quando você clica no botão da extensão ou usa o atalho de teclado.
- Um único site, pedido quando você começa a gravar nele, para acompanhar você de uma página a outra. Nada é concedido na instalação.
- O endereço da sua instância do Piwi, pedido quando você salva uma conexão.

Documentação (em inglês): [piwitests.dev/features/extension](https://piwitests.dev/features/extension)

O Piwi não é afiliado à Microsoft Corporation, nem endossado ou apoiado por ela. Playwright é uma marca registrada da Microsoft Corporation.
