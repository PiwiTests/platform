/** Detect a stable CI run label from well-known environment variables. Returns null outside CI. */
export function detectCiRunLabel(): string | null {
  const env = process.env;
  if (env.GITHUB_ACTIONS && env.GITHUB_RUN_ID) return env.GITHUB_RUN_ID;
  if (env.GITLAB_CI && env.CI_PIPELINE_ID) return env.CI_PIPELINE_ID;
  if (env.CIRCLECI && env.CIRCLE_WORKFLOW_ID) return env.CIRCLE_WORKFLOW_ID;
  if (env.TRAVIS && env.TRAVIS_BUILD_ID) return env.TRAVIS_BUILD_ID;
  if (env.TF_BUILD && env.BUILD_BUILDID) return env.BUILD_BUILDID;
  if (env.JENKINS_URL && env.BUILD_ID) return env.BUILD_ID;
  if (env.BUILDKITE_BUILD_ID) return env.BUILDKITE_BUILD_ID;
  if (env.TEAMCITY_BUILD_ID) return env.TEAMCITY_BUILD_ID;
  if (env.BITBUCKET_BUILD_NUMBER) return env.BITBUCKET_BUILD_NUMBER;
  if (env.SEMAPHORE_WORKFLOW_ID) return env.SEMAPHORE_WORKFLOW_ID;
  if (env.APPVEYOR_BUILD_ID) return env.APPVEYOR_BUILD_ID;
  if (env.DRONE_BUILD_NUMBER) return env.DRONE_BUILD_NUMBER;
  return null;
}
