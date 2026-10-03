package dev.piwitests.jetbrains

import java.net.URI
import java.net.URISyntaxException

/**
 * Who may use Open in IDE (`/api/piwi/open`): a page of a Piwi instance a project open in this IDE reports to, for
 * that project's files, or of the Piwi desktop app running on this machine, for every open project's. The answer
 * names the projects' files, so a page from any other address gets none: not another page on this machine, and not a
 * page the built-in server's own settings trust. The pure half of `PiwiOpenHandler`'s check.
 */
object OpenOrigins {
    /**
     * The origin of an http or https address as a browser sends it in `Origin`: `scheme://host[:port]`, with the scheme
     * and the host in lower case and without the scheme's default port. Null for anything else, the `null` origin of a
     * local file or a sandboxed frame included.
     */
    fun originOf(url: String?): String? {
        val text = url?.trim()?.ifEmpty { null } ?: return null
        val uri = try {
            URI(text)
        } catch (_: URISyntaxException) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host?.lowercase()?.ifEmpty { null } ?: return null
        val port = uri.port.takeUnless { it == -1 || it == if (scheme == "https") 443 else 80 }
        return if (port == null) "$scheme://$host" else "$scheme://$host:$port"
    }

    private val LOOPBACK_HOSTS = listOf("localhost", "127.0.0.1", "[::1]")

    /**
     * The origins the pages of these addresses come from: each address's own and, for one on this machine, the same
     * scheme and port under every loopback name (`localhost`, `127.0.0.1`, `[::1]`), since a browser shows the name
     * that was typed.
     */
    fun allowed(addresses: Iterable<String?>): Set<String> {
        val origins = LinkedHashSet<String>()
        for (address in addresses) {
            val origin = originOf(address) ?: continue
            origins += origin
            val uri = URI(origin)
            if (uri.host in LOOPBACK_HOSTS) {
                val port = if (uri.port == -1) "" else ":${uri.port}"
                LOOPBACK_HOSTS.mapTo(origins) { "${uri.scheme}://$it$port" }
            }
        }
        return origins
    }

    /** Whether a request's `Origin` header names one of [allowed]. A request without one (a link followed, an image) does not. */
    fun isAllowed(origin: String?, allowed: Set<String>): Boolean = originOf(origin)?.let { it in allowed } ?: false

    /**
     * The projects a page of [origin] may open files in: every one of them when it is one of the addresses [everywhere]
     * names (the desktop app, the environment's instance), else those whose own addresses name it, in [byProject]'s
     * order.
     */
    fun <P> projectsFor(origin: String?, everywhere: Iterable<String?>, byProject: Map<P, Iterable<String?>>): List<P> =
        if (isAllowed(origin, allowed(everywhere))) {
            byProject.keys.toList()
        } else {
            byProject.filter { (_, addresses) -> isAllowed(origin, allowed(addresses)) }.keys.toList()
        }

    private val DOTENV_LINE = Regex("^\\s*(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*?)\\s*$")

    /**
     * `PIWI_DASHBOARD_URL` in a `.env` file's text, read as `@piwitests/core/dotenv` reads it: `KEY=value` lines, an
     * optional `export `, single or double quotes, `#` comments, the last line winning. Null when it is not set.
     */
    fun dashboardUrlFromDotEnv(text: String?): String? {
        var url: String? = null
        for (line in text.orEmpty().split(Regex("\\r?\\n"))) {
            val match = DOTENV_LINE.matchEntire(line) ?: continue
            if (match.groupValues[1] != "PIWI_DASHBOARD_URL") continue
            val value = match.groupValues[2]
            val quote = value.firstOrNull()
            url = if ((quote == '"' || quote == '\'') && value.length > 1 && value.last() == quote) {
                val inner = value.substring(1, value.length - 1)
                if (quote == '"') inner.replace("\\n", "\n").replace("\\\"", "\"") else inner
            } else {
                value.replace(Regex("\\s+#.*$"), "")
            }
        }
        return url?.ifEmpty { null }
    }
}
