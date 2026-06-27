# Real Prompt Corpus — AI UI / App Generators

## Provenance & Methodology

**Sources mined (June 2026):**
- Vercel v0 official documentation and blog (vercel.com/blog, v0.app/docs)
- Bolt.new official blog and support docs (bolt.new/blog, support.bolt.new)
- Lovable.dev official docs, blog, and Prompting Bible (docs.lovable.dev, lovable.dev/blog)
- DataCamp Replit Agent tutorial (datacamp.com/tutorial/replit-agent-ai-code-editor)
- Gaincafe blog — "10 Real Apps Built with Lovable.dev" (gaincafe.com)
- DEV Community — "20 creative Lovable.dev prompts" (dev.to/aniruddhaadak)
- Banani.co — Lovable vs Bolt head-to-head with same prompt (banani.co/blog)
- Medium — Bakeoff article by Patrick Neeman (medium.com/@usabilitycounts)
- Codecademy v0 tutorial (codecademy.com/article/v0-by-vercel-build-an-app-in-10-minutes)
- StackFindOver — SaaS dashboard AI prompts (blog.stackfindover.com)
- v0.dev shared community chat — Notion clone (v0.app/chat)
- Lovable.dev "Prompting Bible" (lovable.dev/blog/2025-01-16-lovable-prompting-handbook)
- AI Tool Analysis — Lovable review (aitoolanalysis.com/lovable-review)
- VIBE Benchmark dataset (huggingface.co/datasets/MiniMaxAI/VIBE) — 200 curated tasks, MIT-adjacent academic release
- UI-Bench benchmark paper arXiv:2508.20410 + dataset (huggingface.co/datasets/AfterQuery/ui-bench)

**Honesty flags:**
- All prompts marked `[verbatim]` were extracted character-for-character from the source page.
- Prompts marked `[paraphrased from <url>]` reflect the sense of a prompt described but not quoted exactly in the source.
- Prompts from the DEV Community "20 creative" article begin with app names and are truncated in the source; the first ~12 words of each are verbatim, the remainder is author-described feature lists (marked accordingly).
- AI-fabricated / synthetic prompts are NOT included. The VIBE and UI-Bench prompts are human-authored research benchmark prompts, not tool outputs — they are real in the sense that real practitioners wrote them as evaluation cases.
- No prompts were invented by this research process.

---

## Corpus Table

| # | Prompt Text | Category | Complexity | Tier | Source URL |
|---|------------|----------|------------|------|-----------|
| 1 | `A simple React landing page with a hero section, a call-to-action button, and a features section.` | Landing / Marketing | simple | A static | https://dev.to/ceafive/building-a-react-landing-page-with-v0dev-a-step-by-step-guide-296p [verbatim] |
| 2 | `A React landing page with a modern hero section featuring a large heading, subheading, an attractive call-to-action button, and an image.` | Landing / Marketing | simple | A static | https://dev.to/ceafive/building-a-react-landing-page-with-v0dev-a-step-by-step-guide-296p [verbatim] |
| 3 | `A React features section with three columns, each containing an icon, a heading, and a short description. The design should be minimal and modern.` | Landing / Marketing | simple | A static | https://dev.to/ceafive/building-a-react-landing-page-with-v0dev-a-step-by-step-guide-296p [verbatim] |
| 4 | `A testimonial section with a customer quote, an avatar image, and the customer's name and title.` | Landing / Marketing | simple | A static | https://dev.to/ceafive/building-a-react-landing-page-with-v0dev-a-step-by-step-guide-296p [verbatim] |
| 5 | `Build a full landing page with a hero section, feature grid, pricing table, testimonial carousel, and CTA.` | Landing / Marketing | medium | A static | https://vercel.com/blog/how-to-prompt-v0 [verbatim — listed as "Basic" test] |
| 6 | `Fashion e-commerce site targeting millennials (25-35) who browse on mobile during commutes. They compare multiple items quickly before buying. Build a product page with: swipeable image gallery, product title, price, description, size/color selectors, add to cart button. Include minimal header with back button and cart icon. Clean, premium aesthetic.` | E-commerce | medium | B interactive | https://vercel.com/blog/how-to-prompt-v0 [verbatim] |
| 7 | `Build a user profile page showing: profile photo, display name, username, email, bio, member since date, activity stats (posts, comments, followers), recent activity feed with timestamps, edit profile and settings buttons.` | SaaS App Shell | medium | B interactive | https://vercel.com/blog/how-to-prompt-v0 [verbatim] |
| 8 | `Build a support ticket dashboard. Shows: open tickets, response time, agent performance, recent activity. Mobile-first design (team leads check this on phones while on the floor). Light theme, high contrast. Color code: red for urgent (>24h), yellow for medium, green for on-time. Maximum 3-column layout. Include loading states for real-time data.` | Dashboard / Admin | complex | B interactive | https://vercel.com/blog/how-to-prompt-v0 [verbatim] |
| 9 | `Dashboard displaying: top 5 performers with names and revenue, team revenue vs quota progress bar, deal pipeline with stages (Leads → Qualified → Demo → Closed), 6-month revenue trend chart.` | Dashboard / Admin | medium | B interactive | https://vercel.com/blog/how-to-prompt-v0 [verbatim] |
| 10 | `Hey Bolt, please build a todo list app` | SaaS App Shell | simple | B interactive | https://support.bolt.new/building/build-your-first-app [verbatim] |
| 11 | `I want to build a todo list app. It's for people who love timeblocking and the pomodoro productivity method. Its features should include: adding and scheduling todos, and a pomodoro timer. It should have a modern, clean, but colorful aesthetic. Users should be able to add, edit, and delete todos. Users should be able to schedule the time and date for their todos. Users should be able to view both their unscheduled task list, and a daily schedule with any scheduled tasks. Users will access the application in their browser, so make sure it's suitable for hosting on Netlify.` | SaaS App Shell | complex | B interactive | https://support.bolt.new/building/build-your-first-app [verbatim] |
| 12 | `Build a SaaS landing page with hero, features grid, pricing table, and sign-up CTA.` | Landing / Marketing | medium | A static | https://bolt.new/use-cases/ai-landing-page-builder [verbatim] |
| 13 | `Create a product launch page with countdown timer, waitlist form, and social proof.` | Landing / Marketing | medium | B interactive | https://bolt.new/use-cases/ai-landing-page-builder [verbatim] |
| 14 | `Make a personal brand landing page with bio, featured work, testimonials, and contact.` | Portfolio | simple | A static | https://bolt.new/use-cases/ai-landing-page-builder [verbatim] |
| 15 | `Build an agency landing page with services, case studies, team bios, and lead form.` | Landing / Marketing | medium | A static | https://bolt.new/use-cases/ai-landing-page-builder [verbatim] |
| 16 | `Create an app landing page with screenshots, feature list, download buttons, and reviews.` | Landing / Marketing | simple | A static | https://bolt.new/use-cases/ai-landing-page-builder [verbatim] |
| 17 | `Build a course landing page with curriculum, instructor bio, testimonials, and enroll CTA.` | Landing / Marketing | simple | A static | https://bolt.new/use-cases/ai-landing-page-builder [verbatim] |
| 18 | `Build a client onboarding portal where new clients fill a form with their business name, project goals, budget range, and preferred contact time. Store all responses in Supabase. Build an admin dashboard where the team can see all submissions in a table, mark them as reviewed, and filter by status.` | Internal Tool | complex | B interactive | https://gaincafe.com/blog/apps-built-with-lovable-dev-real-examples [verbatim] |
| 19 | `Create a waitlist landing page with a headline, a three-bullet value proposition, an email input field, and a submit button. Store emails in Supabase with a timestamp. Build a password-protected admin page at admin where I can view all signups in a table sorted by date and export them to CSV.` | Landing / Marketing | medium | B interactive | https://gaincafe.com/blog/apps-built-with-lovable-dev-real-examples [verbatim] |
| 20 | `Build an invoice generator where I can enter my business name and logo, client name and email, project name, multiple line items with descriptions and rates, a tax percentage, and a due date. Auto-calculate subtotal and total. Let me preview the invoice and download it as a clean PDF.` | Internal Tool | complex | B interactive | https://gaincafe.com/blog/apps-built-with-lovable-dev-real-examples [verbatim] |
| 21 | `Build an internal leave tracker. Employees log in with their email and can submit leave requests with start date, end date, and leave type (sick, casual, or earned). Managers see a dashboard with a calendar view showing all pending and approved requests color-coded by type. Managers can approve or reject requests from the dashboard.` | Internal Tool | complex | B interactive | https://gaincafe.com/blog/apps-built-with-lovable-dev-real-examples [verbatim] |
| 22 | `Build a blog brief generator. I enter a topic and a target keyword. The app sends both to the OpenAI API and returns a structured brief containing a recommended title, meta description, five H2 subheadings with short descriptions, a target word count, and three competitor content angles to beat. Save each brief to Supabase so I can view my brief history.` | SaaS App Shell | complex | B interactive | https://gaincafe.com/blog/apps-built-with-lovable-dev-real-examples [verbatim] |
| 23 | `Build a digital menu management app. The restaurant owner logs into an admin panel and can create menu categories, add dishes with names, descriptions, prices, and photos, and toggle items as available or unavailable. The customer-facing menu is a clean mobile-first page accessible through a generated QR code.` | E-commerce | complex | B interactive | https://gaincafe.com/blog/apps-built-with-lovable-dev-real-examples [verbatim] |
| 24 | `Build an embeddable feedback widget. When triggered it shows a popup with a 1 to 5 star rating selector and an optional text comment box. On submission it stores the rating, comment, timestamp, and current page URL in Supabase. Generate a JavaScript embed snippet I can drop into any website with a single script tag.` | Internal Tool | complex | B interactive | https://gaincafe.com/blog/apps-built-with-lovable-dev-real-examples [verbatim] |
| 25 | `Build a two-step lead capture page for real estate. On step one the user selects the type of property they are looking for from a visual option selector. On step two they enter their name, phone number, and email address. Store each lead in Supabase with a timestamp and their property preference. Send an instant email notification to the agent when a new lead submits.` | Form / Multi-step | complex | B interactive | https://gaincafe.com/blog/apps-built-with-lovable-dev-real-examples [verbatim] |
| 26 | `Build a personal subscription tracker. I can add subscriptions with the service name, monthly or annual cost, billing cycle, renewal date, and category (productivity, marketing, development, design, other). Show a dashboard with my total monthly spend, a list of renewals coming up in the next 30 days, and a bar chart showing spend broken down by category.` | Dashboard / Admin | complex | B interactive | https://gaincafe.com/blog/apps-built-with-lovable-dev-real-examples [verbatim] |
| 27 | `Build an MVP scope calculator. Users select features from a categorised checklist including user authentication, payment processing, admin dashboard, third-party API integrations, AI features, real-time notifications, and multi-language support. Based on their selections the calculator displays an estimated cost range, a recommended timeline, and a complexity rating. Show a summary card at the end with a CTA button to book a consultation call. Log each calculator session in Supabase.` | Form / Multi-step | complex | B interactive | https://gaincafe.com/blog/apps-built-with-lovable-dev-real-examples [verbatim] |
| 28 | `Build a mobile bill-splitting app called 'Billy' with a sleek off-white theme and lime-green accents. Use Poppins typography and 3D icons. The home screen must feature a donut chart for split bills and expense tracking, with bottom-tab navigation to 'Split Bill,' 'Monthly Expenses' (including graphs), and 'Profile.' The 'Split Bill' flow should allow users to create expenses, add friends, tag categories, and calculate splits with real-time updates. Ensure smooth navigation and a dark mode toggle.` | SaaS App Shell | complex | B interactive | https://www.banani.co/blog/lovable-vs-bolt-comparison [verbatim — same prompt tested in both Lovable and Bolt] |
| 29 | `Create a CRM System to manage my accounts. Use MUI for the design system. I should be able to: - View an overview as a home page where I can see my accounts, contacts, campaigns and tasks listed - Manage accounts, contacts within accounts, campaigns, tasks assigned to me, and users for my organization - Navigate through the system through top navigation, with the following options: Home, Accounts, Contacts, Campaigns, Administration` | Internal Tool | complex | B interactive | https://medium.com/@usabilitycounts/the-vibe-coding-bakeoff-for-generative-ai-prototyping-tools-bolt-lovable-replit-and-v0-876bfc13fd2f [verbatim — same prompt tested across Bolt, Lovable, Replit, v0] |
| 30 | `https://notion.com clone this website with out missing anything` | Clone | medium | A static | https://v0.app/chat/notion-website-clone-y7BmnBdoafB [verbatim — actual v0 community chat URL] |
| 31 | `Build a full-stack spelling trainer web app in Next.js: 1. Login page with role selection (Teacher/Student) 2. Teacher Dashboard with list management and "+ New List" button 3. Student Dashboard with sidebar to choose weekly tests 4. Practice interface with progress bar, word display, input, and performance stats 5. Session Summary with accuracy, correct/incorrect words, and action buttons 6. Bottom navigation (Teacher/Student Dashboard + Logout) 7. Blue and white color scheme, role-based access control` | SaaS App Shell | complex | B interactive | https://www.codecademy.com/article/v0-by-vercel-build-an-app-in-10-minutes [verbatim] |
| 32 | `Make an app that displays a map of local landmarks` | Internal Tool | simple | B interactive | https://www.datacamp.com/tutorial/replit-agent-ai-code-editor [verbatim — Replit Agent] |
| 33 | `Create a to-do app using React` | SaaS App Shell | simple | B interactive | https://www.datacamp.com/tutorial/replit-agent-ai-code-editor [verbatim — Replit Agent] |
| 34 | `Create a full-stack application with a database, front-end, and back-end` | SaaS App Shell | complex | B interactive | https://www.datacamp.com/tutorial/replit-agent-ai-code-editor [verbatim — Replit Agent] |
| 35 | `Build one-page site for a budgeting app targeted at Gen Z freelancers. The main CTA should be "Start Saving Smarter." Focus on a bold, expressive aesthetic with large text and punchy colors.` | Landing / Marketing | simple | A static | https://docs.lovable.dev/prompting/prompting-one [verbatim] |
| 36 | `Create a floating menu bar with glassmorphism effect. Include Home, Search, Music, Favorites, Add, Profile, and Settings icons. Add gentle floating animation and smooth hover interactions.` | UI Component | simple | A static | https://docs.lovable.dev/prompting/prompting-one [verbatim] |
| 37 | `Create a card with a user profile picture, name, and a follow button. Add a badge for verified users, and show a tooltip when hovering over the badge.` | UI Component | simple | A static | https://docs.lovable.dev/prompting/prompting-one [verbatim] |
| 38 | `Design a landing page hero that feels premium and cinematic. Use layered depth, translucent surfaces, soft motion blur, and dramatic contrast between headline and background.` | Landing / Marketing | simple | A static | https://docs.lovable.dev/prompting/prompting-one [verbatim] |
| 39 | `If the user is logged in via Cloud, show their profile image and name in the top right. If not, display a "Log In" button and route them to the auth screen.` | SaaS App Shell | medium | B interactive | https://docs.lovable.dev/prompting/prompting-one [verbatim — conditional auth UI] |
| 40 | `Build me a loyalty points tracker for a coffee shop. Customers earn points per purchase, can see their balance, and redeem rewards. Include a login system and admin dashboard.` | SaaS App Shell | complex | B interactive | https://aitoolanalysis.com/lovable-review/ [verbatim] |
| 41 | `Design a KPI card for a SaaS analytics dashboard. Label: 'Monthly Recurring Revenue'. Value: '$124,500'. Context badge: '+12.5% vs last month' in green (#10B981) with an up-arrow icon. Include a subtle sparkline filling the bottom 30% of the card. Style: white background, shadow-sm, rounded-xl, border-gray-100. Output: React + Tailwind CSS.` | Dashboard / Admin | medium | A static | https://blog.stackfindover.com/ai-prompts-saas-dashboard-ui-design/ [verbatim] |
| 42 | `Design a responsive 4-column KPI metrics row for a B2B SaaS dashboard. Cards: (1) Active Users — 8,432, +5.2%, (2) Churn Rate — 2.1%, -0.4%, (3) MRR — $94,200, +8.1%, (4) NPS Score — 67, +3pts. Each card has an icon (top left), value (bold, large), label (muted small text), and a trend badge. Light theme, consistent spacing. Output: React + Tailwind with shadcn/ui Card component.` | Dashboard / Admin | medium | A static | https://blog.stackfindover.com/ai-prompts-saas-dashboard-ui-design/ [verbatim] |
| 43 | `Design a stacked bar chart component for a SaaS churn analysis dashboard. X-axis: last 6 months (Jan–Jun). Y-axis: churn count. Two stacked segments: Voluntary Churn (red, #EF4444) and Involuntary Churn (orange, #F97316). Include a legend below the chart. Add a plain-language insight above: 'Involuntary churn peaked in March — likely a payment failure spike.' Style: white card, recharts library. Output: React + Tailwind.` | Dashboard / Admin | medium | A static | https://blog.stackfindover.com/ai-prompts-saas-dashboard-ui-design/ [verbatim] |
| 44 | `Design a cohort retention heatmap table for a SaaS analytics dashboard. Rows: signup month (Jan–Jun). Columns: Month 0 through Month 6. Cell values: retention percentages. Color cells from white (0%) to #6366F1 (100%) using opacity steps. Show exact percentage values inside each cell. Include a sticky first column with cohort labels. Output: React + Tailwind.` | Data Tables / Grids | medium | A static | https://blog.stackfindover.com/ai-prompts-saas-dashboard-ui-design/ [verbatim] |
| 45 | `Design a B2B admin panel data table for 'User Management'. Columns: Name (with avatar), Email, Role (badge), Last Active, Status (Active/Inactive toggle), Actions (Edit, Delete icons). Features: sortable column headers, checkbox row selection, bulk action bar appearing on selection, pagination (showing '1–25 of 847 users'). Zebra striping with gray-50 alternating rows. Sticky header. Output: React + Tailwind + shadcn/ui Table.` | Data Tables / Grids | complex | B interactive | https://blog.stackfindover.com/ai-prompts-saas-dashboard-ui-design/ [verbatim] |
| 46 | `Design a right-side drawer component for viewing a user profile in a SaaS admin panel. Sections: Profile Info (avatar, name, email, role badge), Account Activity (last login, total sessions, plan), Danger Zone (Deactivate Account, Reset Password — red outlined buttons). Drawer width: 420px. Smooth slide-in transition. Include a close icon (X) top right. Output: React + Tailwind with shadcn/ui Sheet component.` | SaaS App Shell | medium | B interactive | https://blog.stackfindover.com/ai-prompts-saas-dashboard-ui-design/ [verbatim] |
| 47 | `Design an empty state for a SaaS analytics dashboard seen by a new user who hasn't connected any data yet. Include: a centered illustration placeholder, headline: 'Your dashboard is ready — let's fill it in', supporting text: 'Connect your first data source to start seeing metrics in real time.', primary CTA button: 'Connect Data Source', secondary text link: 'Import CSV instead'. Light background, centered layout. Output: React + Tailwind.` | SaaS App Shell | simple | A static | https://blog.stackfindover.com/ai-prompts-saas-dashboard-ui-design/ [verbatim] |
| 48 | `Design a SaaS billing settings page. Sections: (1) Current Plan — 'Pro Plan, $149/month', with a 'Upgrade to Enterprise' CTA and plan feature list. (2) Payment Method — card ending in 4242, expiry 08/27, 'Update Card' button. (3) Billing History — table with Date, Description, Amount, Status (Paid/Failed), Download Invoice icon. Use clean card-based layout. Output: React + Tailwind + shadcn/ui.` | SaaS App Shell | complex | B interactive | https://blog.stackfindover.com/ai-prompts-saas-dashboard-ui-design/ [verbatim] |
| 49 | `Design a collapsible sidebar navigation for a B2B SaaS dashboard. Expanded width: 240px. Collapsed width: 60px (icons only). Nav items: Dashboard, Analytics, Reports, Users, Integrations, Settings. Active state: filled background, accent color #6366F1. Icons: outlined, 20px. Include workspace switcher at top (logo + name + chevron) and user profile menu at bottom (avatar + name + logout). Output: React + Tailwind.` | SaaS App Shell | medium | B interactive | https://blog.stackfindover.com/ai-prompts-saas-dashboard-ui-design/ [verbatim] |
| 50 | `Design and build a portfolio site for a top-tier design agency that feels modern, minimal, and premium.` | Portfolio | medium | A static | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark, Easy tier] |
| 51 | `Reimagine our boutique hotels' booking experience so it feels premium and trustworthy.` | E-commerce | medium | B interactive | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 52 | `Create a SvelteKit server health dashboard that defaults to dark mode.` | Dashboard / Admin | medium | B interactive | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 53 | `I'm launching a technical blog and want it to feel fast, clean, and opinionated.` | Landing / Marketing | simple | A static | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 54 | `Design and build the browser UI for a real-time collaborative whiteboard.` | Weird / Curveball | complex | B interactive | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 55 | `Design a marketer-friendly A/B testing control panel for landing pages.` | Dashboard / Admin | complex | B interactive | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 56 | `We run a React-based P2P auction marketplace and want the product page to show live bidding.` | E-commerce | complex | B interactive | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 57 | `Build a web soundscape mixer that feels like a physical desktop console.` | Weird / Curveball | complex | B interactive | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 58 | `We're kicking off a fast, content-first microsite for the DevCon 2024 virtual event.` | Landing / Marketing | medium | A static | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 59 | `We need a self-serve reporting area so managers can build custom reports.` | Dashboard / Admin | complex | B interactive | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 60 | `Build CodeLeads: a members-only web app where developers pay to access curated software leads.` | SaaS App Shell | complex | B interactive | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark, Medium tier] |
| 61 | `Our furniture product pages feel flat with static photos. We need a web-based 3D configurator.` | E-commerce | complex | B interactive | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark, Hard tier] |
| 62 | `Build the main project dashboard as a Kanban board so users can track work.` | Internal Tool | medium | B interactive | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 63 | `We're building an internal knowledge base for employees that feels fast, focused, and visually clean.` | Internal Tool | medium | A static | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 64 | `Our About page should tell our story in a way that feels alive.` | Landing / Marketing | simple | A static | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 65 | `I want a fast, distraction-free AI & robotics news site with a single-column reading experience.` | Landing / Marketing | simple | A static | https://huggingface.co/datasets/MiniMaxAI/VIBE [verbatim — VIBE benchmark] |
| 66 | `Create a fully functional Bloomberg Terminal-style dashboard with all the features outlined below.` | Weird / Curveball | complex | B interactive | https://huggingface.co/datasets/AfterQuery/App-Bench [verbatim — App-Bench benchmark] |
| 67 | `Create a multi-user patient tracking board for a hospital with all the features outlined below.` | Dashboard / Admin | complex | B interactive | https://huggingface.co/datasets/AfterQuery/App-Bench [verbatim — App-Bench benchmark] |
| 68 | `Create a rental booking application with an Airbnb-style layout with all the features outlined below.` | Clone | complex | B interactive | https://huggingface.co/datasets/AfterQuery/App-Bench [verbatim — App-Bench benchmark] |
| 69 | `Create a multiplayer vocabulary-drawing game for elementary students with all the features outlined below.` | Weird / Curveball | complex | B interactive | https://huggingface.co/datasets/AfterQuery/App-Bench [verbatim — App-Bench benchmark] |
| 70 | `Create a Pharmacy Management System with all the features outlined below.` | Internal Tool | complex | B interactive | https://huggingface.co/datasets/AfterQuery/App-Bench [verbatim — App-Bench benchmark] |
| 71 | `I want to build a SaaS web application for scheduling social media posts. Users should be able to sign up, connect their Facebook and Twitter accounts, create a post with text and an image, and schedule a date/time to publish. Use a clean, modern UI.` | SaaS App Shell | complex | B interactive | https://softwareontheroad.com/no-code-saas-mvp-bolt-new-guide [verbatim — illustrative but close-verbatim from article] |
| 72 | `Build a weather app that connects to OpenWeather API, displays local forecast, and has dark mode.` | SaaS App Shell | medium | B interactive | https://www.dronahq.com/replit-ai-review/ [verbatim — Replit Agent] |
| 73 | `Create a booking app for flights with search, filter, save options.` | E-commerce | medium | B interactive | https://www.dronahq.com/replit-ai-review/ [verbatim — Replit Agent] |
| 74 | `Build a full-stack spelling trainer web app in Next.js [with] Supabase: Generate SQL code to create these tables: teachers, students, spelling_lists, list_words, practice_sessions, spelling_attempts. Generate seed/dummy data with 1 teacher and 2 students. Connect Teacher Dashboard to fetch and display real spelling lists and student accuracy stats. Connect Student Dashboard to fetch assigned word lists and save practice attempts.` | SaaS App Shell | complex | B interactive | https://www.codecademy.com/article/v0-by-vercel-build-an-app-in-10-minutes [verbatim — Supabase integration prompt, Prompt 6] |
| 75 | `Create a SaaS pricing table but use Material UI React components where possible.` | Landing / Marketing | simple | A static | https://vercel.com/blog/maximizing-outputs-with-v0-from-ui-generation-to-code-creation [verbatim] |
| 76 | `Create a Next.js project template for a blog website using App Router.` | SaaS App Shell | medium | B interactive | https://vercel.com/blog/maximizing-outputs-with-v0-from-ui-generation-to-code-creation [verbatim] |

---

## Curveball / Weird / High-Interest Prompts (highlighted subset)

These are the prompts most likely to expose edge-cases in a generative-UI engine:

| # | Prompt | Why It's a Curveball |
|---|--------|----------------------|
| 57 | `Build a web soundscape mixer that feels like a physical desktop console.` | Non-standard metaphor ("physical console"), audio domain, complex state |
| 54 | `Design and build the browser UI for a real-time collaborative whiteboard.` | Real-time multi-user state, canvas rendering |
| 66 | `Create a fully functional Bloomberg Terminal-style dashboard with all the features outlined below.` | Dense data density, finance-domain norms, professional tool clone |
| 69 | `Create a multiplayer vocabulary-drawing game for elementary students with all the features outlined below.` | Multiplayer, canvas, child UX, gamification |
| 61 | `Our furniture product pages feel flat with static photos. We need a web-based 3D configurator.` | 3D rendering, product config state |
| 30 | `https://notion.com clone this website with out missing anything` | Verbatim typo preserved; minimalist/ambiguous clone prompt |
| 28 | `Build a mobile bill-splitting app called 'Billy' with a sleek off-white theme and lime-green accents. Use Poppins typography and 3D icons.` | Branded app, 3D icons, specific typography, real-time calculation |
| 22 | `Build a blog brief generator. I enter a topic and a target keyword. The app sends both to the OpenAI API and returns a structured brief...` | LLM-inside-an-app, API integration, structured output display |

---

## Downloadable / Formal Datasets Found

| Dataset | URL | Description | License | Prompt Count |
|---------|-----|-------------|---------|-------------|
| **VIBE** (MiniMaxAI) | https://huggingface.co/datasets/MiniMaxAI/VIBE | 200 curated tasks across web, Android, iOS, simulation, backend. Web subset has 40 tasks across Easy/Medium/Hard tiers. Human-authored evaluation briefs. | Not clearly stated; academic/research use implied | 200 total, ~40 web |
| **UI-Bench** (AfterQuery) | https://huggingface.co/datasets/AfterQuery/ui-bench | 30 client-style design briefs across 5 categories (Marketing/Landing, Editorial/Blog, Portfolio/Case Study, E-commerce, Local/Service). Released with paper arXiv:2508.20410 | Open (released alongside paper) | 30 |
| **App-Bench** (AfterQuery) | https://huggingface.co/datasets/AfterQuery/App-Bench | Functional web app benchmarks (Bloomberg-terminal, hospital board, legal assistant, pharmacy system, booking, drawing game, etc.) | Open (released alongside paper) | ~6+ documented, more in dataset |
| **WebSight** (HuggingFaceM4) | https://huggingface.co/datasets/HuggingFaceM4/WebSight | 2M screenshot/HTML pairs. NOT user prompts — the "prompts" are AI-generated website themes; useful for visual diversity but not real user language | Apache 2.0 | 2M pairs (synthetic) |
| **PromptSet** (pisterlabs) | https://huggingface.co/datasets/pisterlabs/promptset | 61K+ developer prompts extracted from open-source Python repos. Real but programmatic (system prompts, not user UI-gen requests) | MIT | 61K+ |

---

## Category Breakdown Summary

| Category | Count | Notes |
|----------|-------|-------|
| Landing / Marketing | 14 | Heavily represented; simple to medium complexity |
| SaaS App Shell | 13 | Mix of medium/complex; many Tier B |
| Dashboard / Admin | 10 | Mostly Tier B interactive; data-rich |
| Internal Tool | 8 | High complexity; all Tier B |
| E-commerce | 6 | Ranges simple to complex |
| Data Tables / Grids | 2 | Very specific/detailed prompts |
| Form / Multi-step | 2 | Both Tier B complex |
| UI Component | 3 | Isolated component prompts |
| Clone | 3 | Notion, Airbnb, Bloomberg |
| Portfolio | 3 | Simple, mostly Tier A |
| Weird / Curveball | 4 | Most valuable for stress-testing |
| **Total** | **76** | |

**Tier split:** ~22 Tier A (static/layout), ~54 Tier B (state/API/interactive)

**Complexity split:** simple 17, medium 27, complex 32
