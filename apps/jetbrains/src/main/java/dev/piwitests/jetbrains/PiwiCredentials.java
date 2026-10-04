package dev.piwitests.jetbrains;

import com.intellij.credentialStore.CredentialAttributes;

/**
 * A password-safe entry. In Java so the call binds to the one-argument constructor: Kotlin binds to the synthetic
 * default-arguments one, which the platform deprecates.
 */
final class PiwiCredentials {
    private PiwiCredentials() {}

    static CredentialAttributes attributes(String serviceName) {
        return new CredentialAttributes(serviceName);
    }
}
