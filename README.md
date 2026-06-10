# Biblioteca Princesa

Biblioteca digital compartilhada feita para uso no celular. O app permite criar uma estante compartilhada por código, adicionar livros PDF/EPUB, ler dentro do site, salvar progresso, grifar trechos, escrever anotações e sincronizar tudo pelo Supabase.

## Funcionalidades

- Biblioteca compartilhada por código, sem email e sem senha.
- Entrada persistente: a biblioteca continua aberta até clicar em **Sair**.
- Upload de livros em PDF ou EPUB.
- Categorias por toque: Romance, Fantasia, Romantasia, Ficção, Suspense, Terror e Aventura.
- Leitor interno com progresso de leitura e zoom.
- Modo leitura e modo grifo para evitar seleção acidental no celular.
- Grifos coloridos, comentários e anotações manuais.
- Sincronização entre dispositivos usando Supabase Realtime.
- Interface responsiva priorizando uso no celular.

## Estrutura

```text
Biblioteca/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── config.js
│   └── config.example.js
├── supabase/
│   ├── schema.sql
│   ├── modo-pratico.sql
│   └── corrigir-modo-pratico.sql
├── vercel.json
├── .gitignore
├── .gitattributes
├── LICENSE
└── README.md
```

## Configuração do Supabase

1. Crie um projeto no Supabase.
2. Execute `supabase/schema.sql` no SQL Editor.
3. Se precisar do modo mais prático sem confirmação por email, execute `supabase/modo-pratico.sql`.
4. Em **Authentication > Providers > Anonymous**, ative **Anonymous sign-ins**.
5. Em `js/config.js`, coloque a URL pública e a chave `anon/publishable` do Supabase.

> Não coloque senha do banco, `service_role key` ou qualquer segredo no GitHub. A chave pública/anon do Supabase pode ficar no frontend quando as políticas RLS estão configuradas corretamente.

## Rodar localmente

Use um servidor local simples:

```powershell
cd "C:\Users\andre\OneDrive\Documents\Programação\Biblioteca"
python -m http.server 5173
```

Depois abra:

```text
http://localhost:5173
```

## Publicar no GitHub

Pode publicar normalmente no GitHub. Antes, confira se não há arquivos secretos além da chave pública do Supabase.

Comandos básicos:

```powershell
git status
git add .
git commit -m "Finaliza biblioteca compartilhada mobile"
git push
```

## Deploy na Vercel

Sim, pode colocar na Vercel. O projeto é estático, então a Vercel consegue publicar direto.

Configuração recomendada na Vercel:

- Framework Preset: **Other**
- Build Command: deixar vazio
- Output Directory: deixar vazio ou `.`
- Root Directory: pasta do projeto `Biblioteca`

Depois do deploy, entre uma vez com nome e código da biblioteca no domínio da Vercel. O navegador vai salvar essa sessão nesse novo endereço.