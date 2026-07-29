<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <main class="home">
    <h1>hexnome</h1>
    <p class="tagline">
      Build · Adapt · Evolve
    </p>
    <nav>
      <RouterLink
        to="/demo"
        class="cta"
      >
        Open the board demo
      </RouterLink>
    </nav>
  </main>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 4px;
}

h1 {
  margin: 0;
  color: #e8c878;
  font-weight: 600;
  font-size: 44px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.tagline {
  margin: 0 0 32px;
  color: #6b7382;
  font-size: 12px;
  letter-spacing: 0.34em;
  text-transform: uppercase;
}

.cta {
  display: inline-block;
  padding: 11px 22px;
  border: 1px solid #4a3f28;
  border-radius: 3px;
  color: #e8c878;
  font-size: 13px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-decoration: none;
  transition: border-color 140ms, background-color 140ms;
}

.cta:hover {
  border-color: #7d6a41;
  background: rgb(232 200 120 / 8%);
}
</style>
