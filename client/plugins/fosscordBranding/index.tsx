/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import definePlugin from "@utils/types";
import { React } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import { brandMessages } from "./messages";

const env = () => (window as any).GLOBAL_ENV ?? {};

const instanceName = () => String(env().INSTANCE_NAME || "Fosscord");

const imageUrl = (value: unknown) => (typeof value === "string" && /^(https?:\/\/|\/)/.test(value) ? value : "");

const helpUrl = () => (typeof env().HELP_URL === "string" && /^https?:\/\//.test(env().HELP_URL) ? env().HELP_URL : "");

const HELP_HOST = /^(?:https?:)?\/\/(?:(?:support(?:-dev|-apps)?|creator-support)\.discord\.com|dis\.gd)(?=[/?#:]|$)/i;

const isHelpUrl = (url: unknown) => typeof url === "string" && HELP_HOST.test(url);

const helpHref = (href: unknown) => {
    if (typeof href !== "string") return href;
    if (isHelpUrl(href)) return helpUrl() || false;
    if (helpUrl() && href.startsWith(helpUrl()) && /[?&]utm_source=discord/.test(href)) return helpUrl();
    return href;
};

const LOGO_PATH =
    "M3.21 4.84C3.44 3.71 4.58 3.24 5.51 3.78L12 7.59L18.49 3.78C19.42 3.24 20.56 3.71 20.79 4.84L22.8 14.61C23.5 17.82 21.06 20.56 17.78 20.56L6.22 20.56C2.94 20.56 .5 17.82 1.2 14.61ZM7.35 11.06a1.27 1.27 0 0 0-1.27 1.27v2.64a1.27 1.27 0 0 0 1.27 1.27h2.67a1.27 1.27 0 0 0 1.27-1.27v-2.64a1.27 1.27 0 0 0-1.27-1.27ZM13.97 11.06a1.27 1.27 0 0 0-1.27 1.27v2.64a1.27 1.27 0 0 0 1.27 1.27h2.67a1.27 1.27 0 0 0 1.27-1.27v-2.64a1.27 1.27 0 0 0-1.27-1.27Z";

const Icon = ({ size }: { size: number }) =>
    imageUrl(env().INSTANCE_ICON) ? (
        <img src={env().INSTANCE_ICON} width={size} height={size} alt="" style={{ objectFit: "contain" }} />
    ) : (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d={LOGO_PATH} />
        </svg>
    );

const SPINNER_CSS =
    "@keyframes fosscord-spinner-bob{0%,100%{transform:translateY(0) scale(1)}40%{transform:translateY(-10px) scale(1.04,.97)}60%{transform:translateY(-10px) scale(.98,1.03)}}.fosscord-spinner>svg,.fosscord-spinner>img{animation:fosscord-spinner-bob 1.4s cubic-bezier(.45,0,.55,1) infinite;transform-origin:50% 80%}@media (prefers-reduced-motion:reduce){.fosscord-spinner>svg,.fosscord-spinner>img{animation:none}}";

function Spinner({ className, onReady, setRef }: { className?: string; onReady?: () => void; setRef?: (element: HTMLElement | null) => void }) {
    React.useEffect(() => void onReady?.(), []);
    return (
        <div
            ref={setRef}
            className={`fosscord-spinner ${className ?? ""}`}
            data-testid="app-spinner"
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 200,
                height: 200,
                margin: "0 auto",
                color: "var(--text-strong, var(--header-primary, #fff))",
            }}
        >
            <style>{SPINNER_CSS}</style>
            <Icon size={80} />
        </div>
    );
}

let originalOpen: typeof window.open | null = null;

export default definePlugin({
    name: "FosscordBranding",
    description:
        "Uses this instance's name, logo, default avatars and help center instead of Discord's, in every translated string and on the sign-in pages, and Premium instead of Nitro.",
    authors: [FosscordAuthor],
    required: true,

    instanceName,
    helpUrl,
    isHelpUrl,
    brandMessages,

    helpHref,

    helpLink: (url: string) => (isHelpUrl(url) && helpUrl() ? helpUrl() : url),

    plainLink: (children: React.ReactNode, key: React.Key) => <React.Fragment key={key}>{children}</React.Fragment>,

    defaultAvatars: () => {
        const host = env().CDN_HOST || location.host;
        return Array.from({ length: 6 }, (_, i) => `${location.protocol}//${host}/embed/avatars/${i}.png`);
    },

    renderLogo: (fill: string, className?: string) =>
        imageUrl(env().INSTANCE_ICON) ? (
            <image className={className} href={env().INSTANCE_ICON} x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet" />
        ) : (
            <path className={className} fill={fill} d={LOGO_PATH} />
        ),

    renderSpinner: (props: { className?: string; onReady?: () => void; setRef?: (element: HTMLElement | null) => void }) => <Spinner {...props} />,

    renderWordmark: (className: string) =>
        imageUrl(env().INSTANCE_LOGO) ? (
            <img className={className} src={env().INSTANCE_LOGO} alt={instanceName()} style={{ height: 24, width: "auto", objectFit: "contain" }} />
        ) : (
            <div
                className={className}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    height: 24,
                    color: "#fff",
                    fontFamily: 'var(--font-display, "gg sans", sans-serif)',
                    fontSize: 20,
                    fontWeight: 800,
                    lineHeight: "24px",
                }}
            >
                <Icon size={24} />
                {instanceName()}
            </div>
        ),

    start() {
        originalOpen = window.open;
        window.open = function (url?: string | URL, ...rest: any[]) {
            const href = helpHref(url instanceof URL ? url.href : url);
            return href === false ? null : originalOpen!.call(window, href as string | undefined, ...rest);
        } as typeof window.open;
    },

    stop() {
        if (originalOpen) window.open = originalOpen;
    },

    patches: [
        {
            find: "setAuthLogoHidden=",
            replacement: {
                match: /(\i\?null:)\(0,\i\.jsx\)\("img",\{className:(\i\.\i),src:\i,alt:""\}\)/,
                replace: "$1$self.renderWordmark($2)",
            },
        },
        {
            find: /JSON\.parse\('\{"(?:[\w+/]{6}":\[|COMMON_OPEN_DISCORD":")/,
            all: true,
            noWarn: true,
            replacement: {
                match: /JSON\.parse\(('[\s\S]*')\)\}$/,
                replace: "$self.brandMessages(JSON.parse($1))}",
            },
        },
        {
            find: 'link:"https://discord.com/accessibility"',
            replacement: {
                match: /link:"https:\/\/discord\.com\/accessibility"/,
                replace: "link:location.origin",
            },
        },
        {
            find: 'd:"M19.73 4.87a18.2 18.2 0 0 0-4.6-1.44',
            all: true,
            replacement: {
                match: /\(0,\i\.jsx\)\("path",\{fill:([^,{}]+),d:"M19\.73 4\.87a18\.2 18\.2 0 0 0-4\.6-1\.44[^"]*"(?:,className:(\i))?\}\)/,
                replace: "$self.renderLogo($1,$2)",
            },
        },
        {
            find: '"data-testid":"app-spinner"',
            replacement: {
                match: /\(0,\i\.jsx\)\(\i\.\i,\{ref:(\i),onLoadedData:(\i),className:(\i),[^{}]*?"data-testid":"app-spinner",children:\i\},\i\)/,
                replace: "($self.renderSpinner({setRef:$1,onReady:$2,className:$3}))",
            },
        },
        {
            find: "DEFAULT_PROVISIONAL_AVATARS:[",
            replacement: [
                {
                    match: /DEFAULT_AVATARS:\[[^\]]*\]/,
                    replace: "DEFAULT_AVATARS:$self.defaultAvatars()",
                },
                {
                    match: /(BOT_AVATARS:\{clyde:)\i/,
                    replace: "$1$self.defaultAvatars()[0]",
                },
            ],
        },
        {
            find: /\.isPlatformEmbedded\?void 0:"/,
            replacement: {
                match: /(base:\i\(\d+\)\.isPlatformEmbedded\?void 0:)"[^"]*"/,
                replace: "$1$self.instanceName()",
            },
        },
        {
            find: /\[\i\.\i\.DISCORD\]:"[^"]*",\[\i\.\i\.STEAM\]:"Steam"/,
            replacement: {
                match: /(\[\i\.\i\.DISCORD\]:)"[^"]*"/,
                replace: "$1$self.instanceName()",
            },
        },
        {
            find: "otpauth://totp/",
            replacement: {
                match: /(arguments\[2\]:)"[^"]*"(?=;return`otpauth:\/\/totp\/)/,
                replace: "$1$self.instanceName()",
            },
        },
        {
            find: "HELP_CLICKED,{highlighted:",
            replacement: {
                match: /return(\(0,\i\.jsx\)\(\i\.Anchor,\{href:)\i\.\i,(target:"_blank",tabIndex:-1,children:\(0,\i\.jsx\)\(\i\.\i,\{color:)/,
                replace: "return !$self.helpUrl()?null:$1$self.helpUrl(),$2",
            },
        },
        {
            find: "getCommunityURL:",
            replacement: {
                match: /(function \i\(\i\)\{let (\i)=arguments\.length>1&&void 0!==arguments\[1\]\?arguments\[1\]:\i;return )(\2\+\i)\}/,
                replace: "$1$self.helpLink($3)}",
            },
        },
        {
            find: /useDefaultUnderlineStyles:\i=!0/,
            replacement: {
                match: /(let\{href:(\i),onClick:\i,className:\i,children:\i,[^}]*\}=\i;)/,
                replace: "$1$2=$self.helpHref($2);if($2===false)return null;",
            },
        },
        {
            find: "makeReactFormatter)({$i:",
            replacement: {
                match: /(\$link:\((\i),(\i),\i\)=>\{let\[(\i)\]=\i,.{0,80}?case"string":)/,
                replace: "$1$4=$self.helpHref($4);if($4===false)return $self.plainLink($2,$3);",
            },
        },
        {
            find: 'STATUS:"https://discordstatus.com"',
            replacement: {
                match: /STATUS:"https:\/\/discordstatus\.com"/,
                replace: 'STATUS:location.origin+"/status"',
            },
        },
        {
            find: ".TWITTER_SUPPORT,target:",
            replacement: {
                match: /\(0,\i\.jsxs\)\(\i\.Anchor,\{className:\i\.\i,href:\i\.\i\.TWITTER_SUPPORT,target:"_blank",children:\[\(0,\i\.jsx\)\(\i\.\i,\{[^{}]*\}\),\i\.intl\.string\(\i\.t\.\i\)\]\}\),/,
                replace: "",
            },
        },
        {
            find: "isFake:!0",
            replacement: {
                match: /,\(0,\i\.jsx\)\(\i,\{text:\i,isFake:!0\}\)/,
                replace: "",
            },
        },
    ],
});
