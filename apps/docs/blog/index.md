---
title: Blog
sidebar: false
---

<script setup>
import { data as posts } from './posts.data'
</script>

# Blog

Notes on how Piwi is built: the engineering behind the features, and the reasoning behind the trade-offs. Written for people who run Playwright suites and want to know how the parts actually work.

<div class="blog-list">
  <article v-for="post of posts" :key="post.url" class="blog-entry">
    <h2 class="blog-title"><a :href="post.url">{{ post.title }}</a></h2>
    <p class="blog-meta">
      <span v-if="post.date">{{ post.date }}</span>
      <span v-if="post.author"> · {{ post.author }}</span>
    </p>
    <p v-if="post.excerpt" class="blog-excerpt">{{ post.excerpt }}</p>
    <p><a :href="post.url">Read →</a></p>
  </article>
  <p v-if="!posts.length" class="blog-empty">No posts yet.</p>
</div>
