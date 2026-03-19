function getRunnerErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

async function runAuthenticatedUsage(options) {
  const {
    ensureAuth,
    getToken,
    fetchUsage,
    normalizeUsage,
    isAuthError,
    getAuthDiagnostic,
    getAuthFailureDiagnostic,
    getFetchFailureDiagnostic,
    getRetryToken = (refreshedAuth) => getToken(refreshedAuth),
  } = options;

  try {
    const authResult = await ensureAuth({ forceRefresh: false });
    const token = getToken(authResult);
    if (!token) {
      return { provider: null, diagnostic: getAuthDiagnostic(authResult?.status), authResult, retryAttempted: false };
    }

    try {
      const data = await fetchUsage(token);
      return { provider: normalizeUsage(data), diagnostic: null, authResult, retryAttempted: false };
    } catch (error) {
      const message = getRunnerErrorMessage(error);
      if (!isAuthError(message)) {
        return { provider: null, diagnostic: getFetchFailureDiagnostic(error), authResult, retryAttempted: false };
      }

      try {
        const refreshedAuth = await ensureAuth({ forceRefresh: true });
        const retryToken = getRetryToken(refreshedAuth, token);
        if (!retryToken || retryToken === token) {
          return {
            provider: null,
            diagnostic: getAuthDiagnostic(refreshedAuth?.status),
            authResult,
            refreshedAuth,
            retryAttempted: true,
          };
        }

        try {
          const retryData = await fetchUsage(retryToken);
          return {
            provider: normalizeUsage(retryData),
            diagnostic: null,
            authResult,
            refreshedAuth,
            retryAttempted: true,
          };
        } catch (retryError) {
          const retryMessage = getRunnerErrorMessage(retryError);
          if (isAuthError(retryMessage)) {
            return {
              provider: null,
              diagnostic: getAuthDiagnostic(refreshedAuth?.status),
              authResult,
              refreshedAuth,
              retryAttempted: true,
            };
          }

          return {
            provider: null,
            diagnostic: getFetchFailureDiagnostic(retryError),
            authResult,
            refreshedAuth,
            retryAttempted: true,
          };
        }
      } catch (refreshError) {
        return {
          provider: null,
          diagnostic: getAuthFailureDiagnostic(refreshError),
          authResult,
          retryAttempted: true,
        };
      }
    }
  } catch (error) {
    return {
      provider: null,
      diagnostic: getAuthFailureDiagnostic(error),
      retryAttempted: false,
    };
  }
}

module.exports = {
  getRunnerErrorMessage,
  runAuthenticatedUsage,
};
