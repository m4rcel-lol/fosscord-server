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

import type { PatchReplacement } from "@utils/types";
import { filters, mapMangledModuleLazy } from "@webpack";
import { useEffect } from "@webpack/common";

export const FosscordAuthor = { name: "Fosscord", id: 0n };

export const HOME_ROUTE = "/channels/@me";

const Router = mapMangledModuleLazy("transitionTo - Transitioning to", {
    replaceWith: filters.byCode("Replacing route with"),
});

function RedirectHome() {
    useEffect(() => Router.replaceWith(HOME_ROUTE), []);
    return null;
}

export const redirectHome = () => <RedirectHome />;

export const hideSetting = (key: string, { replacesPredicate = false } = {}): PatchReplacement =>
    replacesPredicate
        ? { match: new RegExp(String.raw`(\.${key},\{.{0,400}?)usePredicate:`), replace: "$1usePredicate:()=>!1,_usePredicate:" }
        : { match: new RegExp(String.raw`\.${key},\{`), replace: "$&usePredicate:()=>!1," };
